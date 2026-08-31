import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
  sql,
  sum,
} from "drizzle-orm";
import {
  DatabaseService,
  type DatabaseClient,
} from "../database/database.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import {
  creditCheckIns,
  creditLedger,
  creditPurchases,
  creditRefund,
  creditReservations,
  creditUsage,
} from "../database/schema";
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

export type CreditClient = Pick<
  DatabaseClient,
  "select" | "insert" | "update" | "delete" | "execute"
>;
type LedgerRow = typeof creditLedger.$inferSelect;
type ReservationRow = typeof creditReservations.$inferSelect;

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
  expiresAt?: string;
  createdAt: string;
};

export function activeReservationCondition(now: Date = new Date()) {
  return and(
    eq(creditReservations.status, "reserved"),
    or(isNull(creditReservations.expiresAt), gt(creditReservations.expiresAt, now)),
  );
}

type GrantSnapshot = { grant: LedgerRow; available: number };
type GrantState = { snapshots: GrantSnapshot[]; recoveryDebt: number };

@Injectable()
export class CreditsService {
  constructor(private readonly database: DatabaseService) {}

  async reserveCredits(input: {
    userId: string;
    actionType: CreditActionType;
    reference?: string;
    expiresAt?: Date | null;
  }): Promise<CreditReservationRecord> {
    const amount = creditActionPrices[input.actionType];
    const reference = input.reference?.trim() || crypto.randomUUID();
    return this.database.client.transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      const existing = await this.findReservation(tx, reference);
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
      const [reservation] = await tx
        .insert(creditReservations)
        .values({
          userId: input.userId,
          actionType: input.actionType,
          amount,
          reference,
          expiresAt:
            input.expiresAt === undefined
              ? new Date(Date.now() + reservationTtlMs)
              : input.expiresAt,
        })
        .returning();
      return this.toReservation(reservation);
    });
  }

  async captureReservation(input: {
    reference: string;
  }): Promise<CreditReservationRecord> {
    const result = await this.database.client.transaction((tx) =>
      this.captureReservationInTx(tx, this.requireReference(input.reference)),
    );
    if (result.expired) throw new ConflictException("Credit reservation expired");
    return this.toReservation(result.reservation);
  }

  async captureReservationWithClient(
    client: CreditClient,
    input: { reference: string },
  ): Promise<CreditReservationRecord> {
    const result = await this.captureReservationInTx(
      client,
      this.requireReference(input.reference),
    );
    if (result.expired) throw new ConflictException("Credit reservation expired");
    return this.toReservation(result.reservation);
  }

  private async captureReservationInTx(
    tx: CreditClient,
    reference: string,
  ): Promise<{ expired: boolean; reservation: ReservationRow }> {
    const found = await this.findReservation(tx, reference);
    if (!found) throw new BadRequestException("Credit reservation not found");
    await this.lockUserCredits(tx, found.userId);
    const reservation = await this.findReservation(tx, reference);
    if (!reservation) throw new BadRequestException("Credit reservation not found");
    if (reservation.status === "captured") return { expired: false, reservation };
    if (reservation.status === "released") {
      throw new ConflictException("Credit reservation was released");
    }
    if (reservation.expiresAt && reservation.expiresAt <= new Date()) {
      const [released] = await tx
        .update(creditReservations)
        .set({ status: "released" })
        .where(eq(creditReservations.id, reservation.id))
        .returning();
      return { expired: true, reservation: released };
    }
    const allocations = await this.allocateUsage(
      tx,
      reservation.userId,
      reservation.amount,
    );
    const [usage] = await tx
      .insert(creditLedger)
      .values({
        userId: reservation.userId,
        type: "usage",
        amount: reservation.amount,
        reason: reservation.actionType,
        externalReference: `credit_reservation:${reservation.id}`,
      })
      .returning();
    if (allocations.length) {
      await tx.insert(creditUsage).values(
        allocations.map(({ grant, amount }) => ({
          usageLedgerId: usage.id,
          grantLedgerId: grant.id,
          amount,
        })),
      );
    }
    const [captured] = await tx
      .update(creditReservations)
      .set({ status: "captured" })
      .where(eq(creditReservations.id, reservation.id))
      .returning();
    return { expired: false, reservation: captured };
  }

  async releaseReservation(input: {
    reference: string;
  }): Promise<CreditReservationRecord> {
    return this.database.client.transaction((tx) =>
      this.releaseReservationInTx(tx, input.reference),
    );
  }

  async releaseReservationWithClient(
    client: CreditClient,
    input: { reference: string },
  ): Promise<CreditReservationRecord> {
    return this.releaseReservationInTx(client, input.reference);
  }

  private async releaseReservationInTx(
    tx: CreditClient,
    reference: string,
  ): Promise<CreditReservationRecord> {
    const found = await this.findReservation(tx, reference);
    if (!found) throw new BadRequestException("Credit reservation not found");
    await this.lockUserCredits(tx, found.userId);
    const reservation = await this.findReservation(tx, reference);
    if (!reservation) throw new BadRequestException("Credit reservation not found");
    if (reservation.status !== "reserved") return this.toReservation(reservation);
    const [released] = await tx
      .update(creditReservations)
      .set({ status: "released" })
      .where(
        and(
          eq(creditReservations.id, reservation.id),
          eq(creditReservations.status, "reserved"),
        ),
      )
      .returning();
    if (released) return this.toReservation(released);
    const current = await this.findReservationById(tx, reservation.id);
    if (!current) throw new BadRequestException("Credit reservation not found");
    return this.toReservation(current);
  }

  private requireReference(reference: string): string {
    const trimmed = reference?.trim();
    if (!trimmed) {
      throw new BadRequestException("Credit reservation reference is required");
    }
    return trimmed;
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
    return this.database.client.transaction(async (tx) => {
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
      const [existing] = await client
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.externalReference, input.externalReference))
        .limit(1);
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
    const [ledger] = await client
      .insert(creditLedger)
      .values({
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
      })
      .returning();
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

  async getCheckInStatus(input: { userId: string; month?: string }) {
    const today = this.kstDateString(new Date());
    const currentMonth = today.slice(0, 7);
    const month = input.month ?? currentMonth;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      throw new BadRequestException("Check-in month must use YYYY-MM");
    }
    if (month > currentMonth) {
      throw new BadRequestException("Future check-in month is not allowed");
    }
    const checkedInDates = (
      await this.database.client
        .select({ checkInDate: creditCheckIns.checkInDate })
        .from(creditCheckIns)
        .where(
          and(
            eq(creditCheckIns.userId, input.userId),
            like(creditCheckIns.checkInDate, `${month}-%`),
          ),
        )
        .orderBy(asc(creditCheckIns.checkInDate))
    ).map(({ checkInDate }) => checkInDate);
    const checkedInToday =
      month === currentMonth
        ? checkedInDates.includes(today)
        : Boolean(
            (
              await this.database.client
                .select({ id: creditCheckIns.id })
                .from(creditCheckIns)
                .where(
                  and(
                    eq(creditCheckIns.userId, input.userId),
                    eq(creditCheckIns.checkInDate, today),
                  ),
                )
                .limit(1)
            )[0],
          );
    const monthCheckInCount = checkedInDates.length;
    return {
      today,
      month,
      checkedInToday,
      checkedInDates,
      monthCheckInCount,
      dailyCredits: dailyCheckInCredits,
      milestones: Object.entries(checkInMilestoneBonuses).map(
        ([value, bonusCredits]) => ({
          count: Number(value),
          bonusCredits,
          achieved: monthCheckInCount >= Number(value),
        }),
      ),
    };
  }

  async checkIn(input: { userId: string }) {
    const checkInDate = this.kstDateString(new Date());
    return this.database.client.transaction(async (tx) => {
      try {
        await tx.insert(creditCheckIns).values({
          userId: input.userId,
          checkInDate,
        });
      } catch (error) {
        const databaseError = error as {
          code?: string;
          cause?: { code?: string };
        };
        if (databaseError.code === "23505" || databaseError.cause?.code === "23505") {
          throw new ConflictException("Already checked in today");
        }
        throw error;
      }
      const [{ value: monthCheckInCount }] = await tx
        .select({ value: count() })
        .from(creditCheckIns)
        .where(
          and(
            eq(creditCheckIns.userId, input.userId),
            like(creditCheckIns.checkInDate, `${checkInDate.slice(0, 7)}-%`),
          ),
        );
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
    return this.database.client.transaction(async (tx) => {
      await this.lockUserCredits(tx, input.userId);
      const balance = await this.balanceBreakdown(tx, input.userId);
      if (balance.paidBalance < 0 || balance.availableBalance < input.amount) {
        throw new InsufficientCreditsException();
      }
      const allocations = await this.allocateUsage(tx, input.userId, input.amount);
      const [usage] = await tx
        .insert(creditLedger)
        .values({
          userId: input.userId,
          type: "usage",
          amount: input.amount,
          reason: input.reason.trim(),
        })
        .returning();
      if (allocations.length) {
        await tx.insert(creditUsage).values(
          allocations.map(({ grant, amount }) => ({
            usageLedgerId: usage.id,
            grantLedgerId: grant.id,
            amount,
          })),
        );
      }
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
    const [ledger] = await client
      .insert(creditLedger)
      .values({
        userId: input.userId,
        purchaseId: input.purchaseId,
        type: "refund_recovery",
        creditKind: "paid",
        amount: input.amount,
        reason: input.reason,
        externalReference: `credit_refund:${input.refundId}`,
      })
      .returning();
    return this.toRecord(ledger);
  }

  async getBalance(userId: string): Promise<{
    userId: string;
    balance: number;
    paidBalance: number;
    freeBalance?: number;
  }> {
    const value = await this.balanceBreakdown(this.database.client, userId);
    if (value.paidBalance < 0) {
      return { userId, balance: value.paidBalance, paidBalance: value.paidBalance };
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
    const rows = await this.database.client
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.userId, userId))
      .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id));
    return rows.map((row) => this.toRecord(row));
  }

  async listEntriesPage(
    userId: string,
    input: PageInput,
  ): Promise<Page<CreditRecord>> {
    const cursorId = decodeCursor(input.cursor);
    let cursor: Pick<LedgerRow, "id" | "createdAt"> | undefined;
    if (cursorId) {
      [cursor] = await this.database.client
        .select({ id: creditLedger.id, createdAt: creditLedger.createdAt })
        .from(creditLedger)
        .where(and(eq(creditLedger.id, cursorId), eq(creditLedger.userId, userId)))
        .limit(1);
      if (!cursor) throw new BadRequestException("Invalid cursor");
    }
    const rows = await this.database.client
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.userId, userId),
          cursor
            ? or(
                gt(creditLedger.createdAt, cursor.createdAt),
                and(
                  eq(creditLedger.createdAt, cursor.createdAt),
                  gt(creditLedger.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(creditLedger.createdAt), asc(creditLedger.id))
      .limit(input.limit + 1);
    return pageFromRows(rows.map((row) => this.toRecord(row)), input.limit);
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
    const { snapshots: grants } = await this.grantState(client, input.userId, false);
    const purchaseGrants = grants.filter(
      ({ grant }) => grant.purchaseId === input.purchaseId,
    );
    const originalPaid = purchaseGrants
      .filter(({ grant }) => grant.creditKind === "paid" && !grant.promotionCode)
      .reduce((total, { grant }) => total + grant.amount, 0);
    const remainingPaid = purchaseGrants
      .filter(({ grant }) => grant.creditKind === "paid" && !grant.promotionCode)
      .reduce((total, grant) => total + grant.available, 0);
    const remainingPromotion = purchaseGrants
      .filter(({ grant }) => Boolean(grant.promotionCode))
      .reduce((total, grant) => total + grant.available, 0);
    const originalPromotion = purchaseGrants
      .filter(({ grant }) => Boolean(grant.promotionCode))
      .reduce((total, { grant }) => total + grant.amount, 0);
    const paidPromotionGrants = purchaseGrants.filter(
      ({ grant }) => grant.creditKind === "paid" && Boolean(grant.promotionCode),
    );
    const originalPaidPromotion = paidPromotionGrants.reduce(
      (total, { grant }) => total + grant.amount,
      0,
    );
    const remainingPaidPromotion = paidPromotionGrants.reduce(
      (total, grant) => total + grant.available,
      0,
    );
    const [{ locked }] = await client
      .select({ locked: sum(creditRefund.lockedAmount).mapWith(Number) })
      .from(creditRefund)
      .where(
        and(
          eq(creditRefund.purchaseId, input.purchaseId),
          inArray(creditRefund.status, [
            "reserved",
            "payment_processing",
            "payment_succeeded",
          ]),
        ),
      );
    return {
      originalPaid,
      originalPromotion,
      originalPaidPromotion,
      remainingPaid,
      remainingPromotion,
      remainingPaidPromotion,
      locked: locked ?? 0,
    };
  }

  private async allocateUsage(
    client: CreditClient,
    userId: string,
    amount: number,
  ): Promise<Array<{ grant: LedgerRow; amount: number }>> {
    const { snapshots } = await this.grantState(client, userId);
    const paidBalance = (await this.balanceBreakdown(client, userId)).paidBalance;
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
      client
        .select()
        .from(creditLedger)
        .where(and(eq(creditLedger.userId, userId), eq(creditLedger.type, "grant")))
        .orderBy(
          asc(creditLedger.creditKind),
          asc(creditLedger.expiresAt),
          asc(creditLedger.createdAt),
          asc(creditLedger.id),
        ),
      client
        .select({
          grantLedgerId: creditUsage.grantLedgerId,
          amount: sum(creditUsage.amount).mapWith(Number),
        })
        .from(creditUsage)
        .innerJoin(creditLedger, eq(creditUsage.grantLedgerId, creditLedger.id))
        .where(eq(creditLedger.userId, userId))
        .groupBy(creditUsage.grantLedgerId),
      client
        .select({
          purchaseId: creditLedger.purchaseId,
          amount: sum(creditLedger.amount).mapWith(Number),
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.userId, userId),
            eq(creditLedger.type, "refund_recovery"),
            isNotNull(creditLedger.purchaseId),
          ),
        )
        .groupBy(creditLedger.purchaseId),
      client
        .select({
          purchaseId: creditRefund.purchaseId,
          amount: sum(creditRefund.lockedAmount).mapWith(Number),
        })
        .from(creditRefund)
        .innerJoin(creditPurchases, eq(creditRefund.purchaseId, creditPurchases.id))
        .where(
          and(
            eq(creditPurchases.userId, userId),
            inArray(creditRefund.status, [
              "reserved",
              "payment_processing",
              "payment_succeeded",
            ]),
          ),
        )
        .groupBy(creditRefund.purchaseId),
    ]);
    const used = new Map(usages.map((row) => [row.grantLedgerId, row.amount ?? 0]));
    const purchaseRecoveries = new Map<string, number>();
    for (const row of recoveries) {
      if (row.purchaseId) purchaseRecoveries.set(row.purchaseId, row.amount ?? 0);
    }
    const purchaseLocks = new Map(
      refunds.map((row) => [row.purchaseId, row.amount ?? 0]),
    );

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
        (total, amount) => total + amount,
        0,
      ),
    };
  }

  private async balanceBreakdown(client: CreditClient, userId: string) {
    const [grantState, adjustments, reservations] = await Promise.all([
      this.grantState(client, userId),
      client
        .select({
          creditKind: creditLedger.creditKind,
          amount: sum(creditLedger.amount).mapWith(Number),
        })
        .from(creditLedger)
        .where(
          and(
            eq(creditLedger.userId, userId),
            eq(creditLedger.type, "adjustment"),
          ),
        )
        .groupBy(creditLedger.creditKind),
      client
        .select({ amount: sum(creditReservations.amount).mapWith(Number) })
        .from(creditReservations)
        .where(
          and(eq(creditReservations.userId, userId), activeReservationCondition()),
        ),
    ]);
    const sumByKind = (kind: "free" | "paid") =>
      adjustments.find((row) => row.creditKind === kind)?.amount ?? 0;
    const availableByKind = (kind: "free" | "paid") =>
      grantState.snapshots
        .filter(({ grant }) => grant.creditKind === kind)
        .reduce((total, { available }) => total + available, 0);
    const paidBalance =
      availableByKind("paid") - grantState.recoveryDebt + sumByKind("paid");
    const freeBalance = availableByKind("free") + sumByKind("free");
    const reservedAmount = reservations[0]?.amount ?? 0;
    return {
      paidBalance,
      freeBalance,
      availableBalance:
        paidBalance < 0 ? paidBalance : paidBalance + freeBalance - reservedAmount,
    };
  }

  private async findReservation(client: CreditClient, reference: string) {
    const [row] = await client
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.reference, reference))
      .limit(1);
    return row;
  }

  private async findReservationById(client: CreditClient, id: string) {
    const [row] = await client
      .select()
      .from(creditReservations)
      .where(eq(creditReservations.id, id))
      .limit(1);
    return row;
  }

  private async lockUserCredits(client: CreditClient, userId: string) {
    await client.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credits:${userId}`}, 0))`,
    );
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
      ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
