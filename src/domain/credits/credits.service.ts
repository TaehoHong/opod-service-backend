import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import {
  checkInMilestoneBonuses,
  creditActionPrices,
  CreditActionType,
  dailyCheckInCredits,
  freeCreditTtlDays,
  reservationTtlMs,
  signupBonusCredits,
} from "./credit-pricing";
import { InsufficientCreditsException } from "./insufficient-credits.exception";

type CreditClient = Prisma.TransactionClient | PrismaService;
type LedgerRow = Prisma.CreditLedgerGetPayload<Prisma.CreditLedgerDefaultArgs>;
type ReservationRow =
  Prisma.CreditReservationGetPayload<Prisma.CreditReservationDefaultArgs>;

export type CreditRecord = {
  id: string;
  userId: string;
  type: "grant" | "usage" | "refund_recovery" | "adjustment";
  creditKind?: "free" | "paid";
  purchaseId?: string;
  promotionCode?: string;
  amount: number;
  expiresAt?: string;
  reason: string;
  externalReference?: string;
  createdAt: string;
};

export type CreditReservationRecord = {
  id: string;
  userId: string;
  actionType: string;
  amount: number;
  status: "reserved" | "captured" | "released";
  reference: string;
  expiresAt: string;
  createdAt: string;
};

type GrantSnapshot = {
  grant: LedgerRow;
  available: number;
};

type GrantState = {
  snapshots: GrantSnapshot[];
  recoveryDebt: number;
};

@Injectable()
export class CreditsService {
  constructor(private readonly prisma: PrismaService) {}

  async reserveCredits(input: {
    userId: string;
    actionType: CreditActionType;
    reference?: string;
  }): Promise<CreditReservationRecord> {
    const amount = creditActionPrices[input.actionType];
    const reference = input.reference?.trim() || crypto.randomUUID();

    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      const existing = await tx.creditReservation.findUnique({
        where: { reference },
      });
      if (existing) {
        if (
          existing.userId !== input.userId ||
          existing.actionType !== input.actionType ||
          existing.amount !== amount
        ) {
          throw new ConflictException("Credit reservation reference conflict");
        }
        return this.toReservation(existing);
      }

      const balance = await this.balanceBreakdown(tx, input.userId);
      if (balance.paidBalance < 0 || balance.availableBalance < amount) {
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
      return this.toReservation(reservation);
    });
  }

  async captureReservation(input: {
    reference: string;
  }): Promise<CreditReservationRecord> {
    const reference = input.reference?.trim();
    if (!reference) {
      throw new BadRequestException("Credit reservation reference is required");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const found = await tx.creditReservation.findUnique({
        where: { reference },
      });
      if (!found) {
        throw new BadRequestException("Credit reservation not found");
      }
      await this.lockUserCredits(tx, found.userId);
      const reservation = await tx.creditReservation.findUniqueOrThrow({
        where: { reference },
      });
      if (reservation.status === "captured") {
        return { expired: false, reservation };
      }
      if (reservation.status === "released") {
        throw new ConflictException("Credit reservation was released");
      }
      if (reservation.expiresAt <= new Date()) {
        const released = await tx.creditReservation.update({
          where: { id: reservation.id },
          data: { status: "released" },
        });
        return { expired: true, reservation: released };
      }

      const allocations = await this.allocateUsage(
        tx,
        reservation.userId,
        reservation.amount,
      );
      const usage = await tx.creditLedger.create({
        data: {
          userId: reservation.userId,
          type: "usage",
          amount: reservation.amount,
          reason: reservation.actionType,
          externalReference: `credit_reservation:${reservation.id}`,
        },
      });
      await tx.creditUsage.createMany({
        data: allocations.map(({ grant, amount }) => ({
          usageLedgerId: usage.id,
          grantLedgerId: grant.id,
          amount,
        })),
      });
      const captured = await tx.creditReservation.update({
        where: { id: reservation.id },
        data: { status: "captured" },
      });
      return { expired: false, reservation: captured };
    });

    if (result.expired) {
      throw new ConflictException("Credit reservation expired");
    }
    return this.toReservation(result.reservation);
  }

  async releaseReservation(input: {
    reference: string;
  }): Promise<CreditReservationRecord> {
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
    return this.toReservation(reservation);
  }

  async grantCredits(input: {
    userId: string;
    amount: number;
    reason: string;
    creditKind?: "free" | "paid";
    purchaseId?: string;
    promotionCode?: string;
    externalReference?: string;
    expiresAt?: Date;
  }): Promise<CreditRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      return this.grantCreditsWithClient(tx, input);
    });
  }

  async grantCreditsWithClient(
    client: CreditClient,
    input: {
      userId: string;
      amount: number;
      reason: string;
      creditKind?: "free" | "paid";
      purchaseId?: string;
      promotionCode?: string;
      externalReference?: string;
      expiresAt?: Date;
    },
  ): Promise<CreditRecord> {
    const reason = input.reason?.trim();
    const creditKind = input.creditKind ?? "free";
    if (!Number.isInteger(input.amount) || input.amount <= 0 || !reason) {
      throw new BadRequestException("Credit amount and reason are required");
    }
    if (creditKind === "paid" && !input.purchaseId) {
      throw new BadRequestException("Paid credits require a purchase ID");
    }
    if (input.promotionCode && !input.purchaseId) {
      throw new BadRequestException(
        "Purchase-linked promotion requires a purchase ID",
      );
    }

    if (input.externalReference) {
      const existing = await client.creditLedger.findUnique({
        where: { externalReference: input.externalReference },
      });
      if (existing) {
        if (
          existing.userId !== input.userId ||
          existing.type !== "grant" ||
          existing.amount !== input.amount ||
          existing.creditKind !== creditKind ||
          existing.purchaseId !== (input.purchaseId ?? null)
        ) {
          throw new ConflictException("Credit grant reference conflict");
        }
        return this.toRecord(existing);
      }
    }

    const ledger = await client.creditLedger.create({
      data: {
        userId: input.userId,
        type: "grant",
        creditKind,
        purchaseId: input.purchaseId,
        promotionCode: input.promotionCode,
        amount: input.amount,
        reason,
        externalReference: input.externalReference,
        expiresAt:
          input.expiresAt ??
          (creditKind === "free" ? this.freeCreditExpiry() : undefined),
      },
    });
    return this.toRecord(ledger);
  }

  async grantSignupBonus(userId: string): Promise<CreditRecord> {
    return this.grantCredits({
      userId,
      amount: signupBonusCredits,
      reason: "signup bonus",
      creditKind: "free",
      externalReference: `signup_bonus:${userId}`,
    });
  }

  async checkIn(input: { userId: string }) {
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
      await this.grantCreditsWithClient(tx, {
        userId: input.userId,
        amount: creditsGranted,
        reason: "daily check-in",
        creditKind: "free",
        externalReference: `check_in:${input.userId}:${checkInDate}`,
      });
      return { checkInDate, creditsGranted, milestoneBonus, monthCheckInCount };
    });
  }

  async spendCredits(input: {
    userId: string;
    amount: number;
    reason: string;
  }): Promise<CreditRecord> {
    if (
      !Number.isInteger(input.amount) ||
      input.amount <= 0 ||
      !input.reason?.trim()
    ) {
      throw new BadRequestException("Credit amount and reason are required");
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      const balance = await this.balanceBreakdown(tx, input.userId);
      if (balance.paidBalance < 0 || balance.availableBalance < input.amount) {
        throw new InsufficientCreditsException();
      }
      const allocations = await this.allocateUsage(
        tx,
        input.userId,
        input.amount,
      );
      const usage = await tx.creditLedger.create({
        data: {
          userId: input.userId,
          type: "usage",
          amount: input.amount,
          reason: input.reason.trim(),
        },
      });
      await tx.creditUsage.createMany({
        data: allocations.map(({ grant, amount }) => ({
          usageLedgerId: usage.id,
          grantLedgerId: grant.id,
          amount,
        })),
      });
      return this.toRecord(usage);
    });
  }

  async recordRefundRecoveryWithClient(
    client: CreditClient,
    input: {
      userId: string;
      purchaseId: string;
      amount: number;
      refundId: string;
      reason: string;
    },
  ): Promise<CreditRecord> {
    const ledger = await client.creditLedger.create({
      data: {
        userId: input.userId,
        purchaseId: input.purchaseId,
        type: "refund_recovery",
        creditKind: "paid",
        amount: input.amount,
        reason: input.reason,
        externalReference: `credit_refund:${input.refundId}`,
      },
    });
    return this.toRecord(ledger);
  }

  async getBalance(userId: string): Promise<{
    userId: string;
    balance: number;
    paidBalance: number;
    freeBalance?: number;
  }> {
    const value = await this.balanceBreakdown(this.prisma, userId);
    if (value.paidBalance < 0) {
      return {
        userId,
        balance: value.paidBalance,
        paidBalance: value.paidBalance,
      };
    }
    return {
      userId,
      balance: value.availableBalance,
      paidBalance: value.paidBalance,
      freeBalance: value.freeBalance,
    };
  }

  async getPaidBalanceWithClient(
    client: CreditClient,
    userId: string,
  ): Promise<number> {
    return (await this.balanceBreakdown(client, userId)).paidBalance;
  }

  async listEntries(userId: string): Promise<CreditRecord[]> {
    const rows = await this.prisma.creditLedger.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map((row) => this.toRecord(row));
  }

  async listEntriesPage(
    userId: string,
    input: PageInput,
  ): Promise<Page<CreditRecord>> {
    const cursorId = decodeCursor(input.cursor);
    if (
      cursorId &&
      !(await this.prisma.creditLedger.findFirst({
        where: { id: cursorId, userId },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }
    const rows = await this.prisma.creditLedger.findMany({
      where: { userId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      rows.map((row) => this.toRecord(row)),
      input.limit,
    );
  }

  async getPurchaseCreditSnapshotWithClient(
    client: CreditClient,
    input: { userId: string; purchaseId: string },
  ): Promise<{
    originalPaid: number;
    originalPromotion: number;
    originalPaidPromotion: number;
    remainingPaid: number;
    remainingPromotion: number;
    remainingPaidPromotion: number;
    locked: number;
  }> {
    const { snapshots: grants } = await this.grantState(
      client,
      input.userId,
      false,
    );
    const purchaseGrants = grants.filter(
      ({ grant }) => grant.purchaseId === input.purchaseId,
    );
    const originalPaid = purchaseGrants
      .filter(
        ({ grant }) => grant.creditKind === "paid" && !grant.promotionCode,
      )
      .reduce((sum, { grant }) => sum + grant.amount, 0);
    const remainingPaid = purchaseGrants
      .filter(
        ({ grant }) => grant.creditKind === "paid" && !grant.promotionCode,
      )
      .reduce((sum, grant) => sum + grant.available, 0);
    const remainingPromotion = purchaseGrants
      .filter(({ grant }) => Boolean(grant.promotionCode))
      .reduce((sum, grant) => sum + grant.available, 0);
    const originalPromotion = purchaseGrants
      .filter(({ grant }) => Boolean(grant.promotionCode))
      .reduce((sum, { grant }) => sum + grant.amount, 0);
    const paidPromotionGrants = purchaseGrants.filter(
      ({ grant }) =>
        grant.creditKind === "paid" && Boolean(grant.promotionCode),
    );
    const originalPaidPromotion = paidPromotionGrants.reduce(
      (sum, { grant }) => sum + grant.amount,
      0,
    );
    const remainingPaidPromotion = paidPromotionGrants.reduce(
      (sum, grant) => sum + grant.available,
      0,
    );
    const active = await client.creditRefund.aggregate({
      _sum: { lockedAmount: true },
      where: {
        purchaseId: input.purchaseId,
        status: { in: ["reserved", "payment_processing", "payment_succeeded"] },
      },
    });
    return {
      originalPaid,
      originalPromotion,
      originalPaidPromotion,
      remainingPaid,
      remainingPromotion,
      remainingPaidPromotion,
      locked: active._sum.lockedAmount ?? 0,
    };
  }

  private async allocateUsage(
    client: CreditClient,
    userId: string,
    amount: number,
  ): Promise<Array<{ grant: LedgerRow; amount: number }>> {
    const { snapshots } = await this.grantState(client, userId);
    const paidBalance = (await this.balanceBreakdown(client, userId))
      .paidBalance;
    let paidCapacity = Math.max(0, paidBalance);
    let remaining = amount;
    const result: Array<{ grant: LedgerRow; amount: number }> = [];
    for (const snapshot of snapshots) {
      if (remaining === 0) break;
      const capacity =
        snapshot.grant.creditKind === "paid"
          ? Math.min(snapshot.available, paidCapacity)
          : snapshot.available;
      const take = Math.min(remaining, capacity);
      if (take <= 0) continue;
      result.push({ grant: snapshot.grant, amount: take });
      remaining -= take;
      if (snapshot.grant.creditKind === "paid") paidCapacity -= take;
    }
    if (remaining > 0) throw new InsufficientCreditsException();
    return result;
  }

  private async grantState(
    client: CreditClient,
    userId: string,
    includeRefundLocks = true,
  ): Promise<GrantState> {
    const now = new Date();
    const [grants, usages, recoveries, refunds] = await Promise.all([
      client.creditLedger.findMany({
        where: {
          userId,
          type: "grant",
        },
        orderBy: [
          { creditKind: "asc" },
          { expiresAt: "asc" },
          { createdAt: "asc" },
          { id: "asc" },
        ],
      }),
      client.creditUsage.groupBy({
        by: ["grantLedgerId"],
        _sum: { amount: true },
        where: { grantLedger: { userId } },
      }),
      client.creditLedger.groupBy({
        by: ["purchaseId"],
        _sum: { amount: true },
        where: { userId, type: "refund_recovery", purchaseId: { not: null } },
      }),
      client.creditRefund.groupBy({
        by: ["purchaseId"],
        _sum: { lockedAmount: true },
        where: {
          purchase: { userId },
          status: {
            in: ["reserved", "payment_processing", "payment_succeeded"],
          },
        },
      }),
    ]);
    const used = new Map(
      usages.map((row) => [row.grantLedgerId, row._sum.amount ?? 0]),
    );
    const purchaseRecoveries = new Map<string, number>();
    for (const row of recoveries) {
      if (row.purchaseId) {
        purchaseRecoveries.set(
          row.purchaseId,
          (purchaseRecoveries.get(row.purchaseId) ?? 0) +
            (row._sum.amount ?? 0),
        );
      }
    }
    const purchaseLocks = new Map<string, number>();
    for (const row of refunds) {
      purchaseLocks.set(
        row.purchaseId,
        (purchaseLocks.get(row.purchaseId) ?? 0) + (row._sum.lockedAmount ?? 0),
      );
    }

    const snapshots: GrantSnapshot[] = [];
    for (const grant of grants) {
      let available =
        grant.expiresAt && grant.expiresAt <= now
          ? 0
          : Math.max(0, grant.amount - (used.get(grant.id) ?? 0));
      if (grant.purchaseId) {
        const recovery = purchaseRecoveries.get(grant.purchaseId) ?? 0;
        const recovered = Math.min(available, recovery);
        available -= recovered;
        purchaseRecoveries.set(grant.purchaseId, recovery - recovered);

        if (includeRefundLocks) {
          const lock = purchaseLocks.get(grant.purchaseId) ?? 0;
          const locked = Math.min(available, lock);
          available -= locked;
          purchaseLocks.set(grant.purchaseId, lock - locked);
        }
      }
      snapshots.push({ grant, available });
    }
    return {
      snapshots,
      recoveryDebt: [...purchaseRecoveries.values()].reduce(
        (sum, amount) => sum + amount,
        0,
      ),
    };
  }

  private async balanceBreakdown(client: CreditClient, userId: string) {
    const [grantState, adjustments, reservations] = await Promise.all([
      this.grantState(client, userId),
      client.creditLedger.groupBy({
        by: ["creditKind"],
        _sum: { amount: true },
        where: { userId, type: "adjustment" },
      }),
      client.creditReservation.aggregate({
        _sum: { amount: true },
        where: { userId, status: "reserved", expiresAt: { gt: new Date() } },
      }),
    ]);
    const sumByKind = (
      rows: Array<{
        creditKind: "free" | "paid" | null;
        _sum: { amount: number | null };
      }>,
      kind: "free" | "paid",
    ) => rows.find((row) => row.creditKind === kind)?._sum.amount ?? 0;
    const availableByKind = (kind: "free" | "paid") =>
      grantState.snapshots
        .filter(({ grant }) => grant.creditKind === kind)
        .reduce((sum, { available }) => sum + available, 0);
    const paidBalance =
      availableByKind("paid") -
      grantState.recoveryDebt +
      sumByKind(adjustments, "paid");
    const freeBalance =
      availableByKind("free") + sumByKind(adjustments, "free");
    const reservedAmount = reservations._sum.amount ?? 0;
    return {
      paidBalance,
      freeBalance,
      availableBalance:
        paidBalance < 0
          ? paidBalance
          : paidBalance + freeBalance - reservedAmount,
    };
  }

  private async lockUserCredits(client: CreditClient, userId: string) {
    await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`credits:${userId}`}, 0))`;
  }

  private freeCreditExpiry() {
    return new Date(Date.now() + freeCreditTtlDays * 24 * 60 * 60 * 1000);
  }

  private kstDateString(date: Date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }

  private toRecord(row: LedgerRow): CreditRecord {
    return {
      id: row.id,
      userId: row.userId,
      type: row.type,
      ...(row.creditKind ? { creditKind: row.creditKind } : {}),
      ...(row.purchaseId ? { purchaseId: row.purchaseId } : {}),
      ...(row.promotionCode ? { promotionCode: row.promotionCode } : {}),
      amount: row.amount,
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
      reason: row.reason,
      ...(row.externalReference
        ? { externalReference: row.externalReference }
        : {}),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toReservation(row: ReservationRow): CreditReservationRecord {
    return {
      id: row.id,
      userId: row.userId,
      actionType: row.actionType,
      amount: row.amount,
      status: row.status,
      reference: row.reference,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
