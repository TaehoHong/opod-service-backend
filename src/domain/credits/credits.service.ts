import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import { isUuid } from "../database/uuid";
import {
  checkInMilestoneBonuses,
  CreditActionType,
  creditActionPrices,
  creditPackages,
  dailyCheckInCredits,
  freeCreditTtlDays,
  reservationTtlMs,
  signupBonusCredits,
} from "./credit-pricing";
import { InsufficientCreditsException } from "./insufficient-credits.exception";

type CreditEntryType = "grant" | "debit";
type CreditKind = "free" | "paid";
type CreditPurchaseStatus =
  "pending" | "paid" | "failed" | "canceled" | "refunded";
type PaymentWebhookStatus = Exclude<CreditPurchaseStatus, "pending">;
type CreditReservationStatus = "reserved" | "captured" | "released";
type CreditRefundStatus = "reserved" | "refunded" | "released";
type LocalRefundResult = "succeeded" | "failed";
type RefundReason =
  "user_request" | "company_fault" | "company_price_adjustment";

type CreditGrantInput = {
  userId: string;
  amount: number;
  reason: string;
  creditKind?: CreditKind;
  purchaseId?: string;
  promotionCode?: string;
  externalReference?: string;
  expiresAt?: Date;
};

type CreditEntry = {
  id: string;
  userId: string;
  entryType: CreditEntryType;
  creditKind?: CreditKind;
  purchaseId?: string;
  promotionCode?: string;
  amount: number;
  remainingAmount?: number;
  expiresAt?: string;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

type PrismaCreditEntry =
  Prisma.CreditLedgerEntryGetPayload<Prisma.CreditLedgerEntryDefaultArgs>;

type CreditPurchase = {
  id: string;
  provider: string;
  status: CreditPurchaseStatus;
  creditAmount: number;
  paidAmount: number;
  currency: string;
  createdAt: string;
};

type PrismaCreditPurchase =
  Prisma.CreditPurchaseGetPayload<Prisma.CreditPurchaseDefaultArgs>;

type CreditReservation = {
  id: string;
  userId: string;
  actionType: string;
  amount: number;
  status: CreditReservationStatus;
  reference: string;
  expiresAt: string;
  createdAt: string;
};

type PrismaCreditReservation =
  Prisma.CreditReservationGetPayload<Prisma.CreditReservationDefaultArgs>;

type PrismaCreditRefund =
  Prisma.CreditRefundGetPayload<Prisma.CreditRefundDefaultArgs>;
type PrismaCreditRefundAllocation =
  Prisma.CreditRefundAllocationGetPayload<Prisma.CreditRefundAllocationDefaultArgs>;

type CreditRefund = {
  id: string;
  userId: string;
  purchaseId: string;
  status: CreditRefundStatus;
  creditAmount: number;
  promotionAmount: number;
  grossAmount: number;
  feeAmount: number;
  refundAmount: number;
  currency: string;
  reference: string;
  reason: string;
  createdAt: string;
};

type UserRefundQuote = {
  purchaseId: string;
  currency: string;
  originalCredits: number;
  remainingCredits: number;
  lockedCredits: number;
  refundableCredits: number;
  minimumCredits: number;
  eligible: boolean;
  grossAmount: number;
  feeAmount: number;
  refundAmount: number;
  paidBalanceAfterRefund: number;
  promotionRecoveryCredits: number;
  expectedDebtIncrease: number;
};

type CheckInResult = {
  checkInDate: string;
  creditsGranted: number;
  milestoneBonus: number;
  monthCheckInCount: number;
};

// Subset of the Prisma client used inside credit transactions, so the same
// helpers run on both the root client and interactive transaction clients.
type CreditClient = Pick<
  PrismaService,
  | "user"
  | "creditLedgerEntry"
  | "creditAccount"
  | "creditPurchase"
  | "creditRefund"
  | "creditRefundAllocation"
  | "creditReservation"
  | "creditCheckIn"
  | "$executeRaw"
>;

const activeGrantWhere = (
  userId: string,
  now: Date,
  creditKind?: CreditKind,
) => ({
  userId,
  entryType: "grant" as const,
  ...(creditKind ? { creditKind } : {}),
  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
});

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async createCheckout(input: {
    userId: string;
    creditPackageId: string;
  }): Promise<{
    checkoutId: string;
    provider: "local";
    checkoutUrl: string;
  }> {
    this.assertLocalPaymentStubAllowed();

    const selectedPackage =
      creditPackages[input.creditPackageId as keyof typeof creditPackages];

    if (!selectedPackage) {
      throw new BadRequestException("Unknown credit package");
    }

    const purchase = await this.prisma.creditPurchase.create({
      data: {
        userId: input.userId,
        provider: "local",
        status: "pending",
        creditAmount: selectedPackage.creditAmount,
        paidAmount: selectedPackage.paidAmount,
        currency: selectedPackage.currency,
      },
    });

    return {
      checkoutId: purchase.id,
      provider: "local",
      // ponytail: local checkout URL; replace with provider URL when Toss/Stripe is selected.
      checkoutUrl: `https://payments.local/checkout/${purchase.id}`,
    };
  }

  async reserveCredits(input: {
    userId: string;
    actionType: CreditActionType;
    reference?: string;
  }): Promise<CreditReservation> {
    const amount = creditActionPrices[input.actionType];

    if (!amount) {
      throw new BadRequestException("Unknown credit action");
    }

    const reference = input.reference ?? `${input.actionType}:${randomUUID()}`;

    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);

      if ((await this.availableBalance(tx, input.userId)) < amount) {
        throw new InsufficientCreditsException();
      }

      const reservation = await tx.creditReservation.create({
        data: {
          userId: input.userId,
          actionType: input.actionType,
          amount,
          reference,
          expiresAt: new Date(Date.now() + reservationTtlMs),
        },
      });
      return this.toCreditReservation(reservation as PrismaCreditReservation);
    });
  }

  async captureReservation(input: {
    reference: string;
  }): Promise<CreditReservation> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const found = await tx.creditReservation.findUnique({
        where: { reference: input.reference },
      });

      if (!found) {
        throw new BadRequestException("Credit reservation not found");
      }

      await this.lockUserCredits(tx, found.userId);

      const reservation = (await tx.creditReservation.findUnique({
        where: { reference: input.reference },
      })) as PrismaCreditReservation;

      if (reservation.status === "captured") {
        return {
          expired: false as const,
          reservation: this.toCreditReservation(reservation),
        };
      }
      if (reservation.status === "released") {
        throw new ConflictException("Credit reservation was released");
      }
      if (reservation.expiresAt <= new Date()) {
        await tx.creditReservation.updateMany({
          where: { id: reservation.id, status: "reserved" },
          data: { status: "released" },
        });
        return {
          expired: true as const,
          reservation: this.toCreditReservation({
            ...reservation,
            status: "released",
          }),
        };
      }

      const transition = await tx.creditReservation.updateMany({
        where: { id: reservation.id, status: "reserved" },
        data: { status: "captured" },
      });
      if (transition.count === 0) {
        const current = (await tx.creditReservation.findUnique({
          where: { reference: input.reference },
        })) as PrismaCreditReservation;
        if (current.status === "captured") {
          return {
            expired: false as const,
            reservation: this.toCreditReservation(current),
          };
        }
        throw new ConflictException("Credit reservation was released");
      }

      const consumed = await this.consumeGrantBuckets(
        tx,
        reservation.userId,
        reservation.amount,
      );

      if (consumed > 0) {
        await tx.creditLedgerEntry.create({
          data: {
            userId: reservation.userId,
            entryType: "debit",
            amount: consumed,
            reason: reservation.actionType,
            externalReference: `credit_reservation:${reservation.id}`,
          },
        });
      }

      return {
        expired: false as const,
        reservation: this.toCreditReservation({
          ...reservation,
          status: "captured",
        }),
      };
    });

    if (outcome.expired) {
      throw new ConflictException("Credit reservation expired");
    }
    return outcome.reservation;
  }

  async releaseReservation(input: {
    reference: string;
  }): Promise<CreditReservation> {
    // reserved -> released only; captured/released reservations stay as-is so
    // release stays safe to call from error paths.
    await this.prisma.creditReservation.updateMany({
      where: { reference: input.reference, status: "reserved" },
      data: { status: "released" },
    });

    const reservation = await this.prisma.creditReservation.findUnique({
      where: { reference: input.reference },
    });

    if (!reservation) {
      throw new BadRequestException("Credit reservation not found");
    }
    return this.toCreditReservation(reservation as PrismaCreditReservation);
  }

  async grantCredits(input: CreditGrantInput): Promise<CreditEntry> {
    const creditKind = input.creditKind ?? "free";
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      return this.grantCreditsWithClient(tx, {
        ...input,
        creditKind,
        expiresAt:
          input.expiresAt ??
          (creditKind === "free" ? this.freeCreditExpiry() : undefined),
      });
    });
  }

  async grantSignupBonus(userId: string): Promise<CreditEntry> {
    return this.grantCredits({
      userId,
      amount: signupBonusCredits,
      reason: "signup bonus",
      creditKind: "free",
      externalReference: `signup_bonus:${userId}`,
      expiresAt: this.freeCreditExpiry(),
    });
  }

  async checkIn(input: { userId: string }): Promise<CheckInResult> {
    const checkInDate = this.kstDateString(new Date());

    return this.prisma.$transaction(async (tx) => {
      try {
        await tx.creditCheckIn.create({
          data: { userId: input.userId, checkInDate },
        });
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          throw new ConflictException("Already checked in today");
        }
        throw error;
      }

      const monthCheckInCount = await tx.creditCheckIn.count({
        where: {
          userId: input.userId,
          checkInDate: { startsWith: `${checkInDate.slice(0, 7)}-` },
        },
      });
      const milestoneBonus = checkInMilestoneBonuses[monthCheckInCount] ?? 0;
      const creditsGranted = dailyCheckInCredits + milestoneBonus;

      await tx.creditLedgerEntry.create({
        data: {
          userId: input.userId,
          entryType: "grant",
          creditKind: "free",
          amount: creditsGranted,
          remainingAmount: creditsGranted,
          expiresAt: this.freeCreditExpiry(),
          reason: "daily check-in",
          externalReference: `check_in:${input.userId}:${checkInDate}`,
        },
      });

      return { checkInDate, creditsGranted, milestoneBonus, monthCheckInCount };
    });
  }

  async spendCredits(input: {
    userId: string;
    amount: number;
    reason: string;
  }): Promise<CreditEntry> {
    this.validateEntryInput(input);

    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);

      if ((await this.availableBalance(tx, input.userId)) < input.amount) {
        throw new InsufficientCreditsException();
      }

      await this.consumeGrantBuckets(tx, input.userId, input.amount);

      const entry = await tx.creditLedgerEntry.create({
        data: {
          userId: input.userId,
          entryType: "debit",
          amount: input.amount,
          reason: input.reason.trim(),
        },
      });
      return this.toCreditEntry(entry as PrismaCreditEntry);
    });
  }

  async getBalance(userId: string): Promise<{
    userId: string;
    balance: number;
    paidBalance: number;
    freeBalance?: number;
  }> {
    const balances = await this.balanceBreakdown(this.prisma, userId);
    if (balances.paidBalance < 0) {
      return {
        userId,
        balance: balances.paidBalance,
        paidBalance: balances.paidBalance,
      };
    }
    return {
      userId,
      balance:
        balances.paidBalance + balances.freeBalance - balances.reservedAmount,
      paidBalance: balances.paidBalance,
      freeBalance: balances.freeBalance,
    };
  }

  async listEntries(userId: string): Promise<CreditEntry[]> {
    const entries = await this.prisma.creditLedgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
    });
    return entries.map((entry) =>
      this.toCreditEntry(entry as PrismaCreditEntry),
    );
  }

  async listEntriesPage(
    userId: string,
    input: PageInput,
  ): Promise<Page<CreditEntry>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditLedgerEntry.findFirst({
        where: { id: cursorId, userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const entries = await this.prisma.creditLedgerEntry.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      entries.map((entry) => this.toCreditEntry(entry as PrismaCreditEntry)),
      input.limit,
    );
  }

  async listPurchasesPage(
    userId: string,
    input: PageInput,
  ): Promise<Page<CreditPurchase>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditPurchase.findFirst({
        where: { id: cursorId, userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const purchases = await this.prisma.creditPurchase.findMany({
      where: { userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      purchases.map((purchase) =>
        this.toCreditPurchase(purchase as PrismaCreditPurchase),
      ),
      input.limit,
    );
  }

  async getUserRefundQuote(input: {
    userId: string;
    purchaseId: string;
  }): Promise<UserRefundQuote> {
    this.validateUuid(input.purchaseId, "Credit purchase ID");
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      return this.getUserRefundQuoteWithClient(tx, input);
    });
  }

  async reserveUserRefund(input: {
    userId: string;
    purchaseId: string;
    reference: string;
  }): Promise<CreditRefund> {
    return this.reserveRefund(input, "user_request");
  }

  async reserveCompanyFaultRefund(input: {
    userId: string;
    purchaseId: string;
    reference: string;
  }): Promise<CreditRefund> {
    return this.reserveRefund(input, "company_fault");
  }

  async reserveCompanyPriceAdjustmentRefund(input: {
    userId: string;
    purchaseId: string;
    reference: string;
    refundAmount: number;
  }): Promise<CreditRefund> {
    if (!Number.isInteger(input.refundAmount) || input.refundAmount <= 0) {
      throw new BadRequestException(
        "Price adjustment amount must be a positive integer",
      );
    }
    return this.reserveRefund(
      input,
      "company_price_adjustment",
      input.refundAmount,
    );
  }

  async releaseUserRefund(input: {
    userId: string;
    refundId: string;
  }): Promise<CreditRefund> {
    this.validateUuid(input.refundId, "Credit refund ID");
    return this.prisma.$transaction(async (tx) => {
      const initial = await tx.creditRefund.findFirst({
        where: { id: input.refundId, userId: input.userId },
        include: { purchase: { select: { currency: true } } },
      });
      if (!initial) {
        throw new BadRequestException("Credit refund not found");
      }

      await this.lockUserCredits(tx, input.userId);
      await tx.creditRefund.updateMany({
        where: { id: input.refundId, status: "reserved" },
        data: { status: "released" },
      });
      const refund = (await tx.creditRefund.findUnique({
        where: { id: input.refundId },
        include: { purchase: { select: { currency: true } } },
      })) as PrismaCreditRefund & { purchase: { currency: string } };
      return this.toCreditRefund(refund, refund.purchase.currency);
    });
  }

  async handleLocalRefundResult(input: {
    refundId: string;
    status: LocalRefundResult;
  }): Promise<CreditRefund> {
    this.assertLocalPaymentStubAllowed();
    this.validateUuid(input.refundId, "Credit refund ID");
    if (input.status !== "succeeded" && input.status !== "failed") {
      throw new BadRequestException("Unsupported refund status");
    }

    return this.prisma.$transaction(async (tx) => {
      const initial = (await tx.creditRefund.findUnique({
        where: { id: input.refundId },
        include: { purchase: { select: { currency: true } } },
      })) as
        | (PrismaCreditRefund & {
            purchase: { currency: string };
          })
        | null;
      if (!initial) {
        throw new BadRequestException("Credit refund not found");
      }

      await this.lockUserCredits(tx, initial.userId);
      await this.lockCreditReference(tx, `credit_refund_result:${initial.id}`);
      const refund = (await tx.creditRefund.findUnique({
        where: { id: input.refundId },
        include: {
          purchase: { select: { currency: true } },
          allocations: { include: { ledgerEntry: true } },
        },
      })) as PrismaCreditRefund & {
        purchase: { currency: string };
        allocations: Array<
          PrismaCreditRefundAllocation & { ledgerEntry: PrismaCreditEntry }
        >;
      };

      if (input.status === "failed") {
        if (refund.status === "refunded") {
          throw new ConflictException("Credit refund status conflict");
        }
        if (refund.status === "reserved") {
          const released = await tx.creditRefund.update({
            where: { id: refund.id },
            data: { status: "released" },
            include: { purchase: { select: { currency: true } } },
          });
          return this.toCreditRefund(
            released as PrismaCreditRefund,
            released.purchase.currency,
          );
        }
        return this.toCreditRefund(refund, refund.purchase.currency);
      }

      if (refund.status === "refunded") {
        return this.toCreditRefund(refund, refund.purchase.currency);
      }
      if (refund.status === "released") {
        throw new ConflictException("Credit refund was released");
      }

      let debtIncrease = 0;
      for (const allocation of refund.allocations) {
        const recoveryLeft =
          allocation.recoveryAmount - allocation.recoveredAmount;
        if (recoveryLeft <= 0) {
          continue;
        }
        const remaining = allocation.ledgerEntry.remainingAmount ?? 0;
        const recovered = Math.min(remaining, recoveryLeft);
        if (recovered > 0) {
          await tx.creditLedgerEntry.update({
            where: { id: allocation.ledgerEntryId },
            data: { remainingAmount: remaining - recovered },
          });
        }
        debtIncrease += recoveryLeft - recovered;
        await tx.creditRefundAllocation.update({
          where: {
            refundId_ledgerEntryId: {
              refundId: allocation.refundId,
              ledgerEntryId: allocation.ledgerEntryId,
            },
          },
          data: { recoveredAmount: allocation.recoveryAmount },
        });
      }
      if (debtIncrease > 0) {
        await tx.creditAccount.upsert({
          where: { userId: refund.userId },
          create: { userId: refund.userId, paidDebt: debtIncrease },
          update: { paidDebt: { increment: debtIncrease } },
        });
      }

      const totalRecovery = refund.creditAmount + refund.promotionAmount;
      if (totalRecovery > 0) {
        await tx.creditLedgerEntry.create({
          data: {
            userId: refund.userId,
            purchaseId: refund.purchaseId,
            entryType: "debit",
            amount: totalRecovery,
            reason:
              refund.reason === "user_request"
                ? "user refund"
                : "company fault refund",
            externalReference: `credit_refund:${refund.id}`,
          },
        });
      }
      const completed = await tx.creditRefund.update({
        where: { id: refund.id },
        data: { status: "refunded" },
        include: { purchase: { select: { currency: true } } },
      });
      if (refund.reason !== "company_price_adjustment") {
        await tx.creditPurchase.update({
          where: { id: refund.purchaseId },
          data: { status: "refunded" },
        });
      }
      return this.toCreditRefund(
        completed as PrismaCreditRefund,
        completed.purchase.currency,
      );
    });
  }

  async handlePaymentWebhook(
    provider: string,
    input?: { checkoutId?: unknown; status?: unknown },
  ): Promise<{ received: true }> {
    if (provider !== "local") {
      throw new BadRequestException("Unsupported payment provider");
    }
    this.assertLocalPaymentStubAllowed();

    const checkoutId =
      typeof input?.checkoutId === "string" ? input.checkoutId.trim() : "";
    if (!checkoutId) {
      throw new BadRequestException("Payment checkout ID is required");
    }
    if (!isUuid(checkoutId)) {
      throw new BadRequestException("Payment checkout ID is invalid");
    }

    const status = this.parsePaymentWebhookStatus(input?.status);
    const externalReference = `credit_purchase:${checkoutId}`;

    return this.prisma.$transaction(async (tx) => {
      const initialPurchase = (await tx.creditPurchase.findUnique({
        where: { id: checkoutId },
      })) as PrismaCreditPurchase | null;

      if (!initialPurchase) {
        throw new BadRequestException("Credit purchase not found");
      }
      if (initialPurchase.provider !== provider) {
        throw new BadRequestException("Payment provider mismatch");
      }
      await this.lockUserCredits(tx, initialPurchase.userId);
      await this.lockCreditReference(tx, externalReference);

      const purchase = (await tx.creditPurchase.findUnique({
        where: { id: checkoutId },
      })) as PrismaCreditPurchase;
      if (status === "refunded") {
        throw new ConflictException("Credit purchase status conflict");
      }
      if (purchase.status !== status) {
        if (purchase.status !== "pending") {
          throw new ConflictException("Credit purchase status conflict");
        }

        await tx.creditPurchase.update({
          where: { id: checkoutId },
          data: { status },
        });
      }

      if (status === "paid") {
        // Paid credits never expire.
        await this.grantCreditsWithClient(tx, {
          userId: purchase.userId,
          amount: purchase.creditAmount,
          reason: "credit purchase paid",
          creditKind: "paid",
          purchaseId: purchase.id,
          externalReference,
        });
      }

      return { received: true };
    });
  }

  private freeCreditExpiry(): Date {
    return new Date(Date.now() + freeCreditTtlDays * 24 * 60 * 60 * 1000);
  }

  private assertLocalPaymentStubAllowed() {
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException(
        "Payment provider is not configured",
      );
    }
  }

  private async lockUserCredits(tx: CreditClient, userId: string) {
    // Serializes credit mutations per user for the transaction lifetime, so a
    // balance check and the write that follows it stay race-free. $executeRaw
    // because pg_advisory_xact_lock returns void, which $queryRaw rejects.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`;
  }

  private async lockCreditReference(tx: CreditClient, reference: string) {
    const lockKey = `credit_reference:${reference}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
  }

  private async grantCreditsWithClient(
    client: CreditClient,
    input: CreditGrantInput,
  ): Promise<CreditEntry> {
    this.validateEntryInput(input);
    const reason = input.reason.trim();
    const creditKind = input.creditKind ?? "free";
    const promotionCode = input.promotionCode?.trim() || undefined;
    if (promotionCode && !input.purchaseId) {
      throw new BadRequestException(
        "Purchase-linked promotion requires a purchase ID",
      );
    }
    if (creditKind === "paid" && !input.purchaseId) {
      throw new BadRequestException("Paid credits require a purchase ID");
    }
    if (
      input.purchaseId &&
      !(await client.creditPurchase.findFirst({
        where: { id: input.purchaseId, userId: input.userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Credit purchase not found");
    }

    if (input.externalReference) {
      await this.lockCreditReference(client, input.externalReference);
      const existing = await client.creditLedgerEntry.findFirst({
        where: {
          entryType: "grant",
          externalReference: input.externalReference,
        },
      });
      if (existing) {
        if (
          existing.userId !== input.userId ||
          existing.amount !== input.amount ||
          existing.reason !== reason ||
          existing.creditKind !== creditKind ||
          (existing.purchaseId ?? null) !== (input.purchaseId ?? null) ||
          (existing.promotionCode ?? null) !== (promotionCode ?? null)
        ) {
          throw new ConflictException("Credit grant reference conflict");
        }
        return this.toCreditEntry(existing as PrismaCreditEntry);
      }
    }

    let remainingAmount = input.amount;
    if (creditKind === "paid") {
      const account = await client.creditAccount.upsert({
        where: { userId: input.userId },
        create: { userId: input.userId },
        update: {},
      });
      const offset = Math.min(account.paidDebt, input.amount);
      if (offset > 0) {
        const nextDebt = account.paidDebt - offset;
        await client.creditAccount.update({
          where: { userId: input.userId },
          data: { paidDebt: nextDebt },
        });
        if (nextDebt === 0) {
          await client.user.update({
            where: { id: input.userId },
            data: { debtIdentityHash: null },
          });
        }
        remainingAmount -= offset;
      }
    }

    const entry = await client.creditLedgerEntry.create({
      data: {
        userId: input.userId,
        entryType: "grant",
        creditKind,
        purchaseId: input.purchaseId,
        promotionCode,
        amount: input.amount,
        remainingAmount,
        expiresAt: input.expiresAt,
        reason,
        externalReference: input.externalReference,
      },
    });
    return this.toCreditEntry(entry as PrismaCreditEntry);
  }

  private async availableBalance(
    client: CreditClient,
    userId: string,
  ): Promise<number> {
    const balances = await this.balanceBreakdown(client, userId);
    if (balances.paidBalance < 0) {
      return balances.paidBalance;
    }
    return (
      balances.paidBalance + balances.freeBalance - balances.reservedAmount
    );
  }

  private async balanceBreakdown(client: CreditClient, userId: string) {
    const now = new Date();
    const [paid, free, account, reservations, allocations] = await Promise.all([
      client.creditLedgerEntry.aggregate({
        _sum: { remainingAmount: true },
        where: activeGrantWhere(userId, now, "paid"),
      }),
      client.creditLedgerEntry.aggregate({
        _sum: { remainingAmount: true },
        where: activeGrantWhere(userId, now, "free"),
      }),
      client.creditAccount.findUnique({ where: { userId } }),
      client.creditReservation.aggregate({
        _sum: { amount: true },
        where: { userId, status: "reserved", expiresAt: { gt: now } },
      }),
      client.creditRefundAllocation.findMany({
        where: { refund: { userId, status: "reserved" } },
        select: {
          lockedAmount: true,
          ledgerEntry: { select: { creditKind: true } },
        },
      }),
    ]);
    const paidLocked = allocations
      .filter((allocation) => allocation.ledgerEntry.creditKind === "paid")
      .reduce((sum, allocation) => sum + allocation.lockedAmount, 0);
    const freeLocked = allocations
      .filter((allocation) => allocation.ledgerEntry.creditKind === "free")
      .reduce((sum, allocation) => sum + allocation.lockedAmount, 0);
    return {
      paidBalance:
        (paid._sum.remainingAmount ?? 0) -
        (account?.paidDebt ?? 0) -
        paidLocked,
      freeBalance: (free._sum.remainingAmount ?? 0) - freeLocked,
      reservedAmount: reservations._sum.amount ?? 0,
    };
  }

  private async consumeGrantBuckets(
    tx: CreditClient,
    userId: string,
    amount: number,
  ): Promise<number> {
    const buckets = await this.spendableBuckets(tx, userId);

    let leftToConsume = amount;
    for (const { entry: bucket, availableAmount } of buckets) {
      if (leftToConsume <= 0) {
        break;
      }
      const take = Math.min(availableAmount, leftToConsume);
      await tx.creditLedgerEntry.update({
        where: { id: bucket.id },
        data: { remainingAmount: (bucket.remainingAmount ?? 0) - take },
      });
      leftToConsume -= take;
    }

    return amount - leftToConsume;
  }

  private async getUserRefundQuoteWithClient(
    client: CreditClient,
    input: { userId: string; purchaseId: string },
  ): Promise<UserRefundQuote> {
    return (await this.buildRefundPlan(client, input, "user_request")).quote;
  }

  private async reserveRefund(
    input: { userId: string; purchaseId: string; reference: string },
    reason: RefundReason,
    requestedRefundAmount?: number,
  ): Promise<CreditRefund> {
    this.validateUuid(input.purchaseId, "Credit purchase ID");
    const reference = this.requiredReference(input.reference);

    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      await this.lockCreditReference(tx, `credit_refund:${reference}`);

      const existing = (await tx.creditRefund.findUnique({
        where: { reference },
        include: { purchase: { select: { currency: true } } },
      })) as
        | (PrismaCreditRefund & {
            purchase: { currency: string };
          })
        | null;
      if (existing) {
        if (
          existing.userId !== input.userId ||
          existing.purchaseId !== input.purchaseId ||
          existing.reason !== reason
        ) {
          throw new ConflictException("Credit refund reference conflict");
        }
        return this.toCreditRefund(existing, existing.purchase.currency);
      }
      if (
        await tx.creditRefund.findFirst({
          where: { purchaseId: input.purchaseId, status: "reserved" },
          select: { id: true },
        })
      ) {
        throw new ConflictException("Credit refund is already reserved");
      }

      const plan = await this.buildRefundPlan(
        tx,
        input,
        reason,
        requestedRefundAmount,
      );
      if (!plan.quote.eligible) {
        throw new ConflictException(
          reason !== "user_request"
            ? "Company refund cannot be created"
            : "At least half of the purchased credits must remain",
        );
      }

      const refund = await tx.creditRefund.create({
        data: {
          userId: input.userId,
          purchaseId: input.purchaseId,
          creditAmount: plan.creditAmount,
          promotionAmount: plan.promotionAmount,
          grossAmount: plan.quote.grossAmount,
          feeAmount: plan.quote.feeAmount,
          refundAmount: plan.quote.refundAmount,
          reason,
          reference,
          allocations: {
            create: plan.allocations.map((allocation) => ({
              ledgerEntryId: allocation.ledgerEntryId,
              lockedAmount: allocation.lockedAmount,
              recoveryAmount: allocation.recoveryAmount,
            })),
          },
        },
      });
      return this.toCreditRefund(
        refund as PrismaCreditRefund,
        plan.quote.currency,
      );
    });
  }

  private async buildRefundPlan(
    client: CreditClient,
    input: { userId: string; purchaseId: string },
    reason: RefundReason,
    requestedRefundAmount?: number,
  ) {
    const purchase = await client.creditPurchase.findFirst({
      where: { id: input.purchaseId, userId: input.userId },
    });
    if (!purchase) {
      throw new BadRequestException("Credit purchase not found");
    }

    const purchaseGrants = (await client.creditLedgerEntry.findMany({
      where: {
        purchaseId: input.purchaseId,
        entryType: "grant",
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    })) as PrismaCreditEntry[];
    const paidGrants = purchaseGrants.filter(
      (grant) => grant.creditKind === "paid",
    );
    const grantedPaidCredits = paidGrants.reduce(
      (sum, grant) => sum + grant.amount,
      0,
    );
    if (grantedPaidCredits <= 0 && reason === "user_request") {
      throw new ConflictException("Purchased credits were not granted");
    }
    const originalCredits =
      grantedPaidCredits > 0 ? grantedPaidCredits : purchase.creditAmount;

    const remainingCredits = paidGrants.reduce(
      (sum, grant) => sum + (grant.remainingAmount ?? 0),
      0,
    );
    const availableBuckets = await this.bucketsAfterUsageReservations(
      client,
      input.userId,
    );
    const availableById = new Map(
      availableBuckets.map((bucket) => [
        bucket.entry.id,
        bucket.availableAmount,
      ]),
    );
    const activeLocks = await client.creditRefundAllocation.findMany({
      where: {
        refund: { purchaseId: input.purchaseId, status: "reserved" },
      },
      select: { lockedAmount: true },
    });
    const lockedCredits = activeLocks.reduce(
      (sum, allocation) => sum + allocation.lockedAmount,
      0,
    );

    const selectedPaidGrants =
      reason === "company_fault"
        ? paidGrants.filter((grant) => !grant.promotionCode)
        : reason === "company_price_adjustment"
          ? []
          : paidGrants;
    const paidAllocations = selectedPaidGrants
      .map((grant) => {
        const available = availableById.get(grant.id) ?? 0;
        return {
          ledgerEntryId: grant.id,
          lockedAmount: available,
          recoveryAmount: reason === "company_fault" ? grant.amount : available,
        };
      })
      .filter((allocation) => allocation.recoveryAmount > 0);
    const freePromotionAllocations =
      reason === "user_request"
        ? purchaseGrants
            .filter(
              (grant) =>
                grant.creditKind === "free" && Boolean(grant.promotionCode),
            )
            .map((grant) => ({
              ledgerEntryId: grant.id,
              lockedAmount: availableById.get(grant.id) ?? 0,
              recoveryAmount: grant.amount,
            }))
        : [];
    const allocations = [...paidAllocations, ...freePromotionAllocations];
    const refundableCredits = paidAllocations.reduce(
      (sum, allocation) => sum + allocation.recoveryAmount,
      0,
    );
    const promotionRecoveryCredits = freePromotionAllocations.reduce(
      (sum, allocation) => sum + allocation.recoveryAmount,
      0,
    );
    const expectedDebtIncrease = allocations.reduce(
      (sum, allocation) =>
        sum + allocation.recoveryAmount - allocation.lockedAmount,
      0,
    );
    const promotionDebtIncrease = freePromotionAllocations.reduce(
      (sum, allocation) =>
        sum + allocation.recoveryAmount - allocation.lockedAmount,
      0,
    );

    const minimumCredits = Math.ceil(originalCredits / 2);
    const completedRefunds = await client.creditRefund.aggregate({
      _sum: { refundAmount: true },
      where: { purchaseId: input.purchaseId, status: "refunded" },
    });
    const remainingPaymentAmount =
      purchase.paidAmount - (completedRefunds._sum.refundAmount ?? 0);
    const eligible =
      purchase.status === "paid" &&
      lockedCredits === 0 &&
      (reason === "company_price_adjustment"
        ? (requestedRefundAmount ?? 0) <= remainingPaymentAmount
        : reason === "company_fault"
          ? remainingPaymentAmount > 0
          : refundableCredits >= minimumCredits);
    const grossAmount = !eligible
      ? 0
      : reason === "company_fault"
        ? remainingPaymentAmount
        : reason === "company_price_adjustment"
          ? (requestedRefundAmount ?? 0)
          : Math.floor(
              (purchase.paidAmount * refundableCredits) / originalCredits,
            );
    const feeAmount =
      reason === "user_request" ? Math.floor(grossAmount * 0.05) : 0;
    const balances = await this.balanceBreakdown(client, input.userId);

    return {
      quote: {
        purchaseId: purchase.id,
        currency: purchase.currency,
        originalCredits,
        remainingCredits,
        lockedCredits,
        refundableCredits,
        minimumCredits,
        eligible,
        grossAmount,
        feeAmount,
        refundAmount: grossAmount - feeAmount,
        paidBalanceAfterRefund:
          balances.paidBalance -
          (eligible ? refundableCredits + promotionDebtIncrease : 0),
        promotionRecoveryCredits,
        expectedDebtIncrease,
      },
      allocations,
      creditAmount: refundableCredits,
      promotionAmount: promotionRecoveryCredits,
    };
  }

  private async spendableBuckets(client: CreditClient, userId: string) {
    const [entries, allocations] = await Promise.all([
      client.creditLedgerEntry.findMany({
        where: {
          ...activeGrantWhere(userId, new Date()),
          remainingAmount: { gt: 0 },
        },
        orderBy: [
          { creditKind: "asc" },
          { expiresAt: { sort: "asc", nulls: "last" } },
          { createdAt: "asc" },
          { id: "asc" },
        ],
      }),
      client.creditRefundAllocation.findMany({
        where: { refund: { userId, status: "reserved" } },
        select: { ledgerEntryId: true, lockedAmount: true },
      }),
    ]);
    const lockedByEntry = new Map<string, number>();
    for (const allocation of allocations) {
      lockedByEntry.set(
        allocation.ledgerEntryId,
        (lockedByEntry.get(allocation.ledgerEntryId) ?? 0) +
          allocation.lockedAmount,
      );
    }

    return (entries as PrismaCreditEntry[]).map((entry) => ({
      entry,
      availableAmount:
        (entry.remainingAmount ?? 0) - (lockedByEntry.get(entry.id) ?? 0),
    }));
  }

  private async bucketsAfterUsageReservations(
    client: CreditClient,
    userId: string,
  ) {
    const buckets = await this.spendableBuckets(client, userId);
    const usageReservations = await client.creditReservation.aggregate({
      _sum: { amount: true },
      where: {
        userId,
        status: "reserved",
        expiresAt: { gt: new Date() },
      },
    });
    let usageLeft = usageReservations._sum.amount ?? 0;
    return buckets.map((bucket) => {
      const reservedUsage = Math.min(bucket.availableAmount, usageLeft);
      usageLeft -= reservedUsage;
      return {
        entry: bucket.entry,
        availableAmount: bucket.availableAmount - reservedUsage,
      };
    });
  }

  private toCreditEntry(entry: PrismaCreditEntry): CreditEntry {
    return {
      id: entry.id,
      userId: entry.userId,
      entryType: entry.entryType,
      creditKind: entry.creditKind ?? undefined,
      purchaseId: entry.purchaseId ?? undefined,
      promotionCode: entry.promotionCode ?? undefined,
      amount: entry.amount,
      remainingAmount: entry.remainingAmount ?? undefined,
      expiresAt: entry.expiresAt?.toISOString(),
      reason: entry.reason,
      externalReference: entry.externalReference ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    };
  }

  private toCreditReservation(
    reservation: PrismaCreditReservation,
  ): CreditReservation {
    return {
      id: reservation.id,
      userId: reservation.userId,
      actionType: reservation.actionType,
      amount: reservation.amount,
      status: reservation.status,
      reference: reservation.reference,
      expiresAt: reservation.expiresAt.toISOString(),
      createdAt: reservation.createdAt.toISOString(),
    };
  }

  private toCreditRefund(
    refund: PrismaCreditRefund,
    currency: string,
  ): CreditRefund {
    return {
      id: refund.id,
      userId: refund.userId,
      purchaseId: refund.purchaseId,
      status: refund.status,
      creditAmount: refund.creditAmount,
      promotionAmount: refund.promotionAmount,
      grossAmount: refund.grossAmount,
      feeAmount: refund.feeAmount,
      refundAmount: refund.refundAmount,
      currency,
      reference: refund.reference,
      reason: refund.reason,
      createdAt: refund.createdAt.toISOString(),
    };
  }

  private toCreditPurchase(purchase: PrismaCreditPurchase): CreditPurchase {
    return {
      id: purchase.id,
      provider: purchase.provider,
      status: purchase.status,
      creditAmount: purchase.creditAmount,
      paidAmount: purchase.paidAmount,
      currency: purchase.currency,
      createdAt: purchase.createdAt.toISOString(),
    };
  }

  private parsePaymentWebhookStatus(status: unknown): PaymentWebhookStatus {
    if (
      status === "paid" ||
      status === "failed" ||
      status === "canceled" ||
      status === "refunded"
    ) {
      return status;
    }

    throw new BadRequestException("Unsupported payment status");
  }

  private kstDateString(now: Date): string {
    // KST is a fixed UTC+9 offset with no daylight saving.
    return new Date(now.getTime() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
  }

  private validateEntryInput(input: { amount: number; reason: string }) {
    if (typeof input.reason !== "string" || !input.reason.trim()) {
      throw new BadRequestException("Credit ledger reason is required");
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException("Credit amount must be a positive integer");
    }
  }

  private validateUuid(value: string, label: string) {
    if (!isUuid(value)) {
      throw new BadRequestException(`${label} is invalid`);
    }
  }

  private requiredReference(reference: string) {
    if (typeof reference !== "string" || !reference.trim()) {
      throw new BadRequestException("Credit refund reference is required");
    }
    return reference.trim();
  }
}
