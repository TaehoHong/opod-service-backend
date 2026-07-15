import {
  BadRequestException,
  ConflictException,
  Injectable,
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
type CreditPurchaseStatus =
  "pending" | "paid" | "failed" | "canceled" | "refunded";
type PaymentWebhookStatus = Exclude<CreditPurchaseStatus, "pending">;
type CreditReservationStatus = "reserved" | "captured" | "released";

type CreditGrantInput = {
  userId: string;
  amount: number;
  reason: string;
  externalReference?: string;
  expiresAt?: Date;
};

type CreditEntry = {
  id: string;
  userId: string;
  entryType: CreditEntryType;
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
  | "creditLedgerEntry"
  | "creditPurchase"
  | "creditReservation"
  | "creditCheckIn"
  | "$executeRaw"
>;

const activeGrantWhere = (userId: string, now: Date) => ({
  userId,
  entryType: "grant" as const,
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
    if (!input.externalReference) {
      return this.grantCreditsWithClient(this.prisma, input);
    }

    return this.prisma.$transaction((tx) =>
      this.grantCreditsWithClient(tx, input),
    );
  }

  async grantSignupBonus(userId: string): Promise<CreditEntry> {
    return this.grantCredits({
      userId,
      amount: signupBonusCredits,
      reason: "signup bonus",
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

  async getBalance(
    userId: string,
  ): Promise<{ userId: string; balance: number }> {
    return {
      userId,
      balance: Math.max(0, await this.availableBalance(this.prisma, userId)),
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

  async handlePaymentWebhook(
    provider: string,
    input?: { checkoutId?: unknown; status?: unknown },
  ): Promise<{ received: true }> {
    if (provider !== "local") {
      throw new BadRequestException("Unsupported payment provider");
    }

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
      await this.lockCreditReference(tx, externalReference);
      const purchase = (await tx.creditPurchase.findUnique({
        where: { id: checkoutId },
      })) as PrismaCreditPurchase | null;

      if (!purchase) {
        throw new BadRequestException("Credit purchase not found");
      }
      if (purchase.provider !== provider) {
        throw new BadRequestException("Payment provider mismatch");
      }
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
          externalReference,
        });
      }

      return { received: true };
    });
  }

  private freeCreditExpiry(): Date {
    return new Date(Date.now() + freeCreditTtlDays * 24 * 60 * 60 * 1000);
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
          existing.reason !== reason
        ) {
          throw new ConflictException("Credit grant reference conflict");
        }
        return this.toCreditEntry(existing as PrismaCreditEntry);
      }
    }

    const entry = await client.creditLedgerEntry.create({
      data: {
        userId: input.userId,
        entryType: "grant",
        amount: input.amount,
        remainingAmount: input.amount,
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
    const now = new Date();
    const grants = await client.creditLedgerEntry.aggregate({
      _sum: { remainingAmount: true },
      where: activeGrantWhere(userId, now),
    });
    const reservations = await client.creditReservation.aggregate({
      _sum: { amount: true },
      where: { userId, status: "reserved", expiresAt: { gt: now } },
    });

    return (grants._sum.remainingAmount ?? 0) - (reservations._sum.amount ?? 0);
  }

  private async consumeGrantBuckets(
    tx: CreditClient,
    userId: string,
    amount: number,
  ): Promise<number> {
    const buckets = (await tx.creditLedgerEntry.findMany({
      where: {
        ...activeGrantWhere(userId, new Date()),
        remainingAmount: { gt: 0 },
      },
      // Expiring free credits burn first; paid credits (no expiry) burn last.
      orderBy: [
        { expiresAt: { sort: "asc", nulls: "last" } },
        { createdAt: "asc" },
      ],
    })) as PrismaCreditEntry[];

    let leftToConsume = amount;
    for (const bucket of buckets) {
      if (leftToConsume <= 0) {
        break;
      }
      const take = Math.min(bucket.remainingAmount ?? 0, leftToConsume);
      await tx.creditLedgerEntry.update({
        where: { id: bucket.id },
        data: { remainingAmount: (bucket.remainingAmount ?? 0) - take },
      });
      leftToConsume -= take;
    }

    return amount - leftToConsume;
  }

  private toCreditEntry(entry: PrismaCreditEntry): CreditEntry {
    return {
      id: entry.id,
      userId: entry.userId,
      entryType: entry.entryType,
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
}
