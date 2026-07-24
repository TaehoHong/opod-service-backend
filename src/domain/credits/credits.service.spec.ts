import { CreditsService } from "./credits.service";
import { InsufficientCreditsException } from "./insufficient-credits.exception";

type LedgerRow = {
  id: string;
  userId: string;
  entryType: "grant" | "debit";
  creditKind: "free" | "paid" | null;
  purchaseId: string | null;
  promotionCode: string | null;
  amount: number;
  remainingAmount: number | null;
  expiresAt: Date | null;
  reason: string;
  externalReference: string | null;
  createdAt: Date;
};

type ReservationRow = {
  id: string;
  userId: string;
  actionType: string;
  amount: number;
  status: "reserved" | "captured" | "released";
  reference: string;
  expiresAt: Date;
  createdAt: Date;
};

type CheckInRow = {
  id: string;
  userId: string;
  checkInDate: string;
  createdAt: Date;
};

type RefundRow = {
  id: string;
  userId: string;
  purchaseId: string;
  status: "reserved" | "refunded" | "released";
  creditAmount: number;
  grossAmount: number;
  feeAmount: number;
  refundAmount: number;
  promotionAmount: number;
  reason: string;
  reference: string;
  createdAt: Date;
  updatedAt: Date;
};

type RefundAllocationRow = {
  refundId: string;
  ledgerEntryId: string;
  lockedAmount: number;
  recoveryAmount: number;
  recoveredAmount: number;
};

// In-memory stand-in for the Prisma queries the credits service issues, so
// tests exercise reserve/capture/release and bucket consumption end to end.
function createCreditsFake(seed?: {
  entries?: Partial<LedgerRow>[];
  reservations?: Partial<ReservationRow>[];
  checkIns?: Partial<CheckInRow>[];
  paidDebt?: number;
}) {
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

  const entries: LedgerRow[] = (seed?.entries ?? []).map((entry) => ({
    id: nextId("entry"),
    userId: "human-1",
    entryType: "grant",
    creditKind: null,
    purchaseId: null,
    promotionCode: null,
    amount: 0,
    remainingAmount: null,
    expiresAt: null,
    reason: "seed",
    externalReference: null,
    createdAt: new Date(),
    ...entry,
  }));
  entries.forEach((entry) => {
    entry.creditKind ??= entry.expiresAt ? "free" : "paid";
  });
  let paidDebt = seed?.paidDebt ?? 0;
  const reservations: ReservationRow[] = (seed?.reservations ?? []).map(
    (reservation) => ({
      id: nextId("reservation"),
      userId: "human-1",
      actionType: "chat_reply",
      amount: 2,
      status: "reserved",
      reference: nextId("reference"),
      expiresAt: new Date(Date.now() + 60_000),
      createdAt: new Date(),
      ...reservation,
    }),
  );
  const checkIns: CheckInRow[] = (seed?.checkIns ?? []).map((checkIn) => ({
    id: nextId("check-in"),
    userId: "human-1",
    checkInDate: "1970-01-01",
    createdAt: new Date(),
    ...checkIn,
  }));

  const isActiveGrant = (entry: LedgerRow, now: Date) =>
    entry.entryType === "grant" &&
    (entry.expiresAt === null || entry.expiresAt > now);

  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: undefined as unknown,
    user: { update: jest.fn().mockResolvedValue({ id: "human-1" }) },
    creditLedgerEntry: {
      aggregate: jest.fn(
        async ({
          where,
        }: {
          where: { userId: string; creditKind?: "free" | "paid" };
        }) => ({
          _sum: {
            remainingAmount: entries
              .filter(
                (entry) =>
                  entry.userId === where.userId &&
                  (!where.creditKind ||
                    entry.creditKind === where.creditKind) &&
                  isActiveGrant(entry, new Date()),
              )
              .reduce((sum, entry) => sum + (entry.remainingAmount ?? 0), 0),
          },
        }),
      ),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: {
            userId: string;
            creditKind?: "free" | "paid";
            remainingAmount?: { gt: number };
          };
        }) => {
          const rows = entries.filter(
            (entry) =>
              entry.userId === where.userId &&
              (!where.creditKind || entry.creditKind === where.creditKind),
          );
          if (!where.remainingAmount) {
            return rows;
          }
          const now = new Date();
          return rows
            .filter(
              (entry) =>
                isActiveGrant(entry, now) && (entry.remainingAmount ?? 0) > 0,
            )
            .sort((first, second) => {
              if (first.creditKind !== second.creditKind) {
                return first.creditKind === "free" ? -1 : 1;
              }
              if (first.expiresAt === null && second.expiresAt === null) {
                return (
                  first.createdAt.getTime() - second.createdAt.getTime() ||
                  first.id.localeCompare(second.id)
                );
              }
              if (first.expiresAt === null) {
                return 1;
              }
              if (second.expiresAt === null) {
                return -1;
              }
              return (
                first.expiresAt.getTime() - second.expiresAt.getTime() ||
                first.createdAt.getTime() - second.createdAt.getTime() ||
                first.id.localeCompare(second.id)
              );
            });
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { entryType?: string; externalReference?: string };
        }) =>
          entries.find(
            (entry) =>
              (!where.entryType || entry.entryType === where.entryType) &&
              (!where.externalReference ||
                entry.externalReference === where.externalReference),
          ) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Partial<LedgerRow> }) => {
        const row: LedgerRow = {
          id: nextId("entry"),
          userId: "human-1",
          entryType: "grant",
          creditKind: null,
          purchaseId: null,
          promotionCode: null,
          amount: 0,
          remainingAmount: null,
          expiresAt: null,
          reason: "",
          externalReference: null,
          createdAt: new Date(),
          ...data,
        };
        entries.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<LedgerRow>;
        }) => {
          const row = entries.find((entry) => entry.id === where.id);
          if (!row) {
            throw new Error("missing ledger entry");
          }
          Object.assign(row, data);
          return row;
        },
      ),
    },
    creditAccount: {
      findUnique: jest.fn(async () =>
        paidDebt > 0 ? { userId: "human-1", paidDebt } : null,
      ),
      upsert: jest.fn(async () => ({ userId: "human-1", paidDebt })),
      update: jest.fn(async ({ data }: { data: { paidDebt: number } }) => {
        paidDebt = data.paidDebt;
        return { userId: "human-1", paidDebt };
      }),
    },
    creditRefund: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { creditAmount: 0 },
      }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    creditRefundAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    creditReservation: {
      aggregate: jest.fn(async ({ where }: { where: { userId: string } }) => {
        const now = new Date();
        return {
          _sum: {
            amount: reservations
              .filter(
                (reservation) =>
                  reservation.userId === where.userId &&
                  reservation.status === "reserved" &&
                  reservation.expiresAt > now,
              )
              .reduce((sum, reservation) => sum + reservation.amount, 0),
          },
        };
      }),
      create: jest.fn(async ({ data }: { data: Partial<ReservationRow> }) => {
        const row: ReservationRow = {
          id: nextId("reservation"),
          userId: "human-1",
          actionType: "chat_reply",
          amount: 0,
          status: "reserved",
          reference: "",
          expiresAt: new Date(),
          createdAt: new Date(),
          ...data,
        };
        reservations.push(row);
        return row;
      }),
      findUnique: jest.fn(
        async ({ where }: { where: { reference: string } }) =>
          reservations.find(
            (reservation) => reservation.reference === where.reference,
          ) ?? null,
      ),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<ReservationRow>;
        }) => {
          const row = reservations.find(
            (reservation) => reservation.id === where.id,
          );
          if (!row) {
            throw new Error("missing reservation");
          }
          Object.assign(row, data);
          return row;
        },
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id?: string;
            reference?: string;
            status: ReservationRow["status"];
          };
          data: Partial<ReservationRow>;
        }) => {
          const rows = reservations.filter(
            (reservation) =>
              (!where.id || reservation.id === where.id) &&
              (!where.reference || reservation.reference === where.reference) &&
              reservation.status === where.status,
          );
          rows.forEach((row) => Object.assign(row, data));
          return { count: rows.length };
        },
      ),
    },
    creditCheckIn: {
      create: jest.fn(
        async ({ data }: { data: Omit<CheckInRow, "id" | "createdAt"> }) => {
          if (
            checkIns.some(
              (checkIn) =>
                checkIn.userId === data.userId &&
                checkIn.checkInDate === data.checkInDate,
            )
          ) {
            throw { code: "P2002" };
          }
          const row: CheckInRow = {
            id: nextId("check-in"),
            createdAt: new Date(),
            ...data,
          };
          checkIns.push(row);
          return row;
        },
      ),
      count: jest.fn(
        async ({
          where,
        }: {
          where: { userId: string; checkInDate: { startsWith: string } };
        }) =>
          checkIns.filter(
            (checkIn) =>
              checkIn.userId === where.userId &&
              checkIn.checkInDate.startsWith(where.checkInDate.startsWith),
          ).length,
      ),
    },
  };
  prisma.$transaction = (run: (tx: unknown) => Promise<unknown>) => run(prisma);

  const service = new (
    CreditsService as new (prisma: unknown) => CreditsService
  )(prisma);
  return { service, prisma, entries, reservations, checkIns };
}

type PurchaseStatus = "pending" | "paid" | "failed" | "canceled" | "refunded";
const paymentPurchaseId = "00000000-0000-4000-8000-000000000001";

function createPaymentHarness(
  status: PurchaseStatus = "pending",
  options?: {
    existingGrant?: boolean;
    failGrant?: boolean;
    failLedgerCreateTimes?: number;
    paidDebt?: number;
    remainingAmount?: number;
    usageReservationAmount?: number;
    promotionGrants?: Array<{
      creditKind: "free" | "paid";
      amount: number;
      remainingAmount: number;
      promotionCode: string;
    }>;
    creditAmount?: number;
    paidAmount?: number;
  },
) {
  const createdAt = new Date("2026-07-02T00:00:00.000Z");
  const purchase = {
    id: paymentPurchaseId,
    userId: "human-1",
    provider: "local",
    status,
    creditAmount: options?.creditAmount ?? 1050,
    paidAmount: options?.paidAmount ?? 9900,
    currency: "KRW",
    createdAt,
    updatedAt: createdAt,
  };
  const entries: LedgerRow[] = options?.existingGrant
    ? [
        {
          id: "grant-1",
          userId: purchase.userId,
          entryType: "grant",
          creditKind: "paid",
          purchaseId: purchase.id,
          promotionCode: null,
          amount: purchase.creditAmount,
          remainingAmount: options?.remainingAmount ?? purchase.creditAmount,
          expiresAt: null,
          reason: "credit purchase paid",
          externalReference: `credit_purchase:${purchase.id}`,
          createdAt,
        },
      ]
    : [];
  let ledgerCreateFailuresLeft = options?.failLedgerCreateTimes ?? 0;
  for (const promotion of options?.promotionGrants ?? []) {
    entries.push({
      id: `promotion-${entries.length + 1}`,
      userId: purchase.userId,
      entryType: "grant",
      purchaseId: purchase.id,
      expiresAt:
        promotion.creditKind === "free"
          ? new Date("2026-08-01T00:00:00.000Z")
          : null,
      reason: "purchase promotion",
      externalReference: `promotion:${promotion.promotionCode}`,
      createdAt,
      ...promotion,
    });
  }

  const creditLedgerEntry = {
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: { entryType?: string; externalReference?: string };
      }) =>
        entries.find(
          (entry) =>
            (!where.entryType || entry.entryType === where.entryType) &&
            (!where.externalReference ||
              entry.externalReference === where.externalReference),
        ) ?? null,
    ),
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          purchaseId?: string;
          userId?: string;
          creditKind?: "free" | "paid";
          entryType?: "grant" | "debit";
          remainingAmount?: { gt: number };
        };
      }) =>
        entries.filter(
          (entry) =>
            (!where.purchaseId || entry.purchaseId === where.purchaseId) &&
            (!where.userId || entry.userId === where.userId) &&
            (!where.creditKind || entry.creditKind === where.creditKind) &&
            (!where.entryType || entry.entryType === where.entryType) &&
            (!where.remainingAmount ||
              (entry.remainingAmount ?? 0) > where.remainingAmount.gt),
        ),
    ),
    aggregate: jest.fn(
      async ({
        where,
      }: {
        where: { userId: string; creditKind?: "free" | "paid" };
      }) => ({
        _sum: {
          remainingAmount: entries
            .filter(
              (entry) =>
                entry.userId === where.userId &&
                entry.entryType === "grant" &&
                (!where.creditKind || entry.creditKind === where.creditKind),
            )
            .reduce((sum, entry) => sum + (entry.remainingAmount ?? 0), 0),
        },
      }),
    ),
    create: jest.fn(async ({ data }: { data: Partial<LedgerRow> }) => {
      if (options?.failGrant || ledgerCreateFailuresLeft > 0) {
        ledgerCreateFailuresLeft -= 1;
        throw new Error("ledger write failed");
      }
      const entry: LedgerRow = {
        id: `grant-${entries.length + 1}`,
        userId: purchase.userId,
        entryType: "grant",
        creditKind: null,
        purchaseId: null,
        promotionCode: null,
        amount: 0,
        remainingAmount: null,
        expiresAt: null,
        reason: "",
        externalReference: null,
        createdAt,
        ...data,
      };
      entries.push(entry);
      return entry;
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<LedgerRow>;
      }) => {
        const entry = entries.find((row) => row.id === where.id);
        if (!entry) throw new Error("missing ledger entry");
        Object.assign(entry, data);
        return entry;
      },
    ),
  };
  const creditPurchase = {
    findUnique: jest.fn(async () => ({ ...purchase })),
    findFirst: jest.fn(
      async ({ where }: { where: { id: string; userId: string } }) =>
        where.id === purchase.id && where.userId === purchase.userId
          ? { ...purchase }
          : null,
    ),
    update: jest.fn(async ({ data }: { data: { status: PurchaseStatus } }) => {
      Object.assign(purchase, data);
      return { ...purchase };
    }),
  };
  let paidDebt = options?.paidDebt ?? 0;
  const creditAccount = {
    findUnique: jest.fn(async () =>
      paidDebt > 0 ? { userId: purchase.userId, paidDebt } : null,
    ),
    upsert: jest.fn(
      async ({
        create,
        update,
      }: {
        create?: { paidDebt?: number };
        update?: { paidDebt?: { increment: number } };
      } = {}) => {
        if (paidDebt === 0 && create?.paidDebt) {
          paidDebt = create.paidDebt;
        } else if (update?.paidDebt?.increment) {
          paidDebt += update.paidDebt.increment;
        }
        return { userId: purchase.userId, paidDebt };
      },
    ),
    update: jest.fn(async ({ data }: { data: { paidDebt: number } }) => {
      paidDebt = data.paidDebt;
      return { userId: purchase.userId, paidDebt };
    }),
  };
  const refunds: RefundRow[] = [];
  const refundAllocations: RefundAllocationRow[] = [];
  const creditRefund = {
    aggregate: jest.fn(
      async ({
        where,
      }: {
        where: { userId?: string; purchaseId?: string; status: string };
      }) => ({
        _sum: {
          creditAmount: refunds
            .filter(
              (refund) =>
                refund.status === where.status &&
                (!where.userId || refund.userId === where.userId) &&
                (!where.purchaseId || refund.purchaseId === where.purchaseId),
            )
            .reduce((sum, refund) => sum + refund.creditAmount, 0),
          refundAmount: refunds
            .filter(
              (refund) =>
                refund.status === where.status &&
                (!where.userId || refund.userId === where.userId) &&
                (!where.purchaseId || refund.purchaseId === where.purchaseId),
            )
            .reduce((sum, refund) => sum + refund.refundAmount, 0),
        },
      }),
    ),
    findMany: jest.fn(
      async ({ where }: { where: { userId: string; status: string } }) =>
        refunds
          .filter(
            (refund) =>
              refund.userId === where.userId && refund.status === where.status,
          )
          .map(({ purchaseId, creditAmount }) => ({
            purchaseId,
            creditAmount,
          })),
    ),
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: {
          id?: string;
          userId?: string;
          purchaseId?: string;
          status?: RefundRow["status"];
        };
      }) => {
        const refund = refunds.find(
          (row) =>
            (!where.id || row.id === where.id) &&
            (!where.userId || row.userId === where.userId) &&
            (!where.purchaseId || row.purchaseId === where.purchaseId) &&
            (!where.status || row.status === where.status),
        );
        return refund
          ? {
              ...refund,
              purchase: { currency: purchase.currency },
              allocations: refundAllocations
                .filter((allocation) => allocation.refundId === refund.id)
                .map((allocation) => ({
                  ...allocation,
                  ledgerEntry: entries.find(
                    (entry) => entry.id === allocation.ledgerEntryId,
                  ),
                })),
            }
          : null;
      },
    ),
    findUnique: jest.fn(
      async ({ where }: { where: { id?: string; reference?: string } }) => {
        const refund = refunds.find(
          (row) =>
            (!where.id || row.id === where.id) &&
            (!where.reference || row.reference === where.reference),
        );
        return refund
          ? {
              ...refund,
              purchase: { currency: purchase.currency },
              allocations: refundAllocations
                .filter((allocation) => allocation.refundId === refund.id)
                .map((allocation) => ({
                  ...allocation,
                  ledgerEntry: entries.find(
                    (entry) => entry.id === allocation.ledgerEntryId,
                  ),
                })),
            }
          : null;
      },
    ),
    create: jest.fn(async ({ data }: { data: Partial<RefundRow> }) => {
      const refund: RefundRow = {
        id: "00000000-0000-4000-8000-000000000002",
        userId: purchase.userId,
        purchaseId: purchase.id,
        status: "reserved",
        creditAmount: 0,
        grossAmount: 0,
        feeAmount: 0,
        refundAmount: 0,
        promotionAmount: 0,
        reason: "user_request",
        reference: "",
        createdAt,
        updatedAt: createdAt,
        ...data,
      };
      refunds.push(refund);
      const allocations = (
        data as Partial<RefundRow> & {
          allocations?: { create?: Omit<RefundAllocationRow, "refundId">[] };
        }
      ).allocations?.create;
      if (allocations) {
        refundAllocations.push(
          ...allocations.map((allocation) => ({
            ...allocation,
            refundId: refund.id,
            recoveredAmount: allocation.recoveredAmount ?? 0,
          })),
        );
      }
      return refund;
    }),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<RefundRow>;
      }) => {
        const refund = refunds.find((row) => row.id === where.id);
        if (!refund) throw new Error("missing refund");
        Object.assign(refund, data);
        return { ...refund, purchase: { currency: purchase.currency } };
      },
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; status: RefundRow["status"] };
        data: Partial<RefundRow>;
      }) => {
        const rows = refunds.filter(
          (row) => row.id === where.id && row.status === where.status,
        );
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    ),
  };
  const creditRefundAllocation = {
    findMany: jest.fn(
      async ({
        where,
      }: {
        where: {
          refund: {
            userId?: string;
            purchaseId?: string;
            status: RefundRow["status"];
          };
        };
      }) =>
        refundAllocations
          .filter((allocation) => {
            const refund = refunds.find(
              (row) => row.id === allocation.refundId,
            );
            return (
              refund?.status === where.refund.status &&
              (!where.refund.userId || refund.userId === where.refund.userId) &&
              (!where.refund.purchaseId ||
                refund.purchaseId === where.refund.purchaseId)
            );
          })
          .map((allocation) => ({
            ...allocation,
            ledgerEntry: {
              creditKind:
                entries.find((entry) => entry.id === allocation.ledgerEntryId)
                  ?.creditKind ?? null,
            },
          })),
    ),
    update: jest.fn(
      async ({
        where,
        data,
      }: {
        where: {
          refundId_ledgerEntryId: {
            refundId: string;
            ledgerEntryId: string;
          };
        };
        data: { recoveredAmount: number };
      }) => {
        const allocation = refundAllocations.find(
          (row) =>
            row.refundId === where.refundId_ledgerEntryId.refundId &&
            row.ledgerEntryId === where.refundId_ledgerEntryId.ledgerEntryId,
        );
        if (!allocation) throw new Error("missing refund allocation");
        allocation.recoveredAmount = data.recoveredAmount;
        return allocation;
      },
    ),
  };
  const creditReservation = {
    aggregate: jest.fn().mockResolvedValue({
      _sum: { amount: options?.usageReservationAmount ?? 0 },
    }),
  };
  const prisma = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: undefined as unknown,
    user: { update: jest.fn().mockResolvedValue({ id: purchase.userId }) },
    creditAccount,
    creditLedgerEntry,
    creditPurchase,
    creditRefund,
    creditRefundAllocation,
    creditReservation,
  };
  prisma.$transaction = jest.fn(
    async (run: (tx: typeof prisma) => Promise<unknown>) => {
      const purchaseSnapshot = { ...purchase };
      const entriesSnapshot = entries.map((entry) => ({ ...entry }));
      const refundsSnapshot = refunds.map((refund) => ({ ...refund }));
      const allocationsSnapshot = refundAllocations.map((allocation) => ({
        ...allocation,
      }));
      const paidDebtSnapshot = paidDebt;
      try {
        return await run(prisma);
      } catch (error) {
        Object.assign(purchase, purchaseSnapshot);
        entries.splice(0, entries.length, ...entriesSnapshot);
        refunds.splice(0, refunds.length, ...refundsSnapshot);
        refundAllocations.splice(
          0,
          refundAllocations.length,
          ...allocationsSnapshot,
        );
        paidDebt = paidDebtSnapshot;
        throw error;
      }
    },
  );

  const service = new (
    CreditsService as new (prisma: unknown) => CreditsService
  )(prisma);
  return {
    service,
    prisma,
    purchase,
    entries,
    creditAccount,
    creditLedgerEntry,
    refunds,
    creditPurchase,
  };
}

describe("CreditsService", () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-15T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("reserves, captures, and consumes expiring grants before paid ones", async () => {
    const { service, entries, reservations } = createCreditsFake({
      entries: [
        {
          amount: 100,
          remainingAmount: 100,
          expiresAt: null,
          reason: "credit purchase paid",
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        {
          amount: 10,
          remainingAmount: 10,
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
          reason: "signup bonus",
          createdAt: new Date("2026-07-10T00:00:00.000Z"),
        },
      ],
    });

    const reservation = await service.reserveCredits({
      userId: "human-1",
      actionType: "chat_reply",
    });
    expect(reservation.status).toBe("reserved");
    expect(reservation.amount).toBe(2);
    // Reserved credits are held out of the spendable balance.
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 108,
      paidBalance: 100,
      freeBalance: 10,
    });

    const captured = await service.captureReservation({
      reference: reservation.reference,
    });
    expect(captured.status).toBe("captured");

    // The expiring signup bonus is consumed before the paid grant.
    expect(
      entries.find((entry) => entry.reason === "signup bonus"),
    ).toMatchObject({ remainingAmount: 8 });
    expect(
      entries.find((entry) => entry.reason === "credit purchase paid"),
    ).toMatchObject({ remainingAmount: 100 });
    expect(entries.find((entry) => entry.entryType === "debit")).toMatchObject({
      amount: 2,
      reason: "chat_reply",
      externalReference: `credit_reservation:${reservations[0].id}`,
    });
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 108,
      paidBalance: 100,
      freeBalance: 8,
    });
  });

  it("consumes the oldest paid purchase first", async () => {
    const { service, entries } = createCreditsFake({
      entries: [
        {
          id: "newer-paid",
          creditKind: "paid",
          amount: 10,
          remainingAmount: 10,
          createdAt: new Date("2026-07-10T00:00:00.000Z"),
        },
        {
          id: "older-paid",
          creditKind: "paid",
          amount: 10,
          remainingAmount: 10,
          createdAt: new Date("2026-07-01T00:00:00.000Z"),
        },
      ],
    });

    await service.spendCredits({
      userId: "human-1",
      amount: 2,
      reason: "chat_reply",
    });

    expect(entries.find((entry) => entry.id === "older-paid")).toMatchObject({
      remainingAmount: 8,
    });
    expect(entries.find((entry) => entry.id === "newer-paid")).toMatchObject({
      remainingAmount: 10,
    });
  });

  it("rejects reservations beyond the available balance", async () => {
    const { service } = createCreditsFake({
      entries: [{ amount: 3, remainingAmount: 3, expiresAt: null }],
      reservations: [
        { amount: 2, expiresAt: new Date("2026-07-15T00:05:00.000Z") },
      ],
    });

    await expect(
      service.reserveCredits({ userId: "human-1", actionType: "chat_reply" }),
    ).rejects.toThrow(InsufficientCreditsException);
  });

  it("keeps free credits hidden and unusable while paid debt remains", async () => {
    const { service } = createCreditsFake({
      entries: [
        {
          amount: 100,
          remainingAmount: 100,
          expiresAt: new Date("2026-08-01T00:00:00.000Z"),
        },
      ],
      paidDebt: 200,
    });

    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: -200,
      paidBalance: -200,
    });
    await expect(
      service.reserveCredits({ userId: "human-1", actionType: "chat_reply" }),
    ).rejects.toThrow(InsufficientCreditsException);
  });

  it("ignores expired grants for balance and spending", async () => {
    const { service } = createCreditsFake({
      entries: [
        {
          amount: 50,
          remainingAmount: 50,
          expiresAt: new Date("2026-07-01T00:00:00.000Z"),
        },
        { amount: 10, remainingAmount: 10, expiresAt: null },
      ],
    });

    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 10,
      paidBalance: 10,
      freeBalance: 0,
    });
    await expect(
      service.spendCredits({ userId: "human-1", amount: 11, reason: "drain" }),
    ).rejects.toThrow("Insufficient credits");
  });

  it("releases reserved credits and keeps captured ones untouched", async () => {
    const { service } = createCreditsFake({
      entries: [{ amount: 10, remainingAmount: 10, expiresAt: null }],
    });

    const reservation = await service.reserveCredits({
      userId: "human-1",
      actionType: "chat_reply",
    });
    const released = await service.releaseReservation({
      reference: reservation.reference,
    });
    expect(released.status).toBe("released");
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 10,
      paidBalance: 10,
      freeBalance: 0,
    });

    const second = await service.reserveCredits({
      userId: "human-1",
      actionType: "chat_reply",
    });
    await service.captureReservation({ reference: second.reference });
    // Releasing after capture must not undo the charge.
    const afterCapture = await service.releaseReservation({
      reference: second.reference,
    });
    expect(afterCapture.status).toBe("captured");
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 8,
      paidBalance: 8,
      freeBalance: 0,
    });
  });

  it("does not let release overwrite or precede an in-progress capture", async () => {
    const { service, prisma, entries } = createCreditsFake({
      entries: [{ amount: 10, remainingAmount: 10, expiresAt: null }],
    });
    const reservation = await service.reserveCredits({
      userId: "human-1",
      actionType: "chat_reply",
    });

    let captureReachedBuckets!: () => void;
    const reachedBuckets = new Promise<void>((resolve) => {
      captureReachedBuckets = resolve;
    });
    let continueCapture!: () => void;
    const mayContinue = new Promise<void>((resolve) => {
      continueCapture = resolve;
    });
    const originalFindMany =
      prisma.creditLedgerEntry.findMany.getMockImplementation();
    if (!originalFindMany) {
      throw new Error("credit ledger fake is missing findMany");
    }
    prisma.creditLedgerEntry.findMany.mockImplementationOnce(async (input) => {
      captureReachedBuckets();
      await mayContinue;
      return originalFindMany(input);
    });

    const capture = service.captureReservation({
      reference: reservation.reference,
    });
    await reachedBuckets;
    const release = await service.releaseReservation({
      reference: reservation.reference,
    });
    continueCapture();
    const captured = await capture;

    expect(release.status).toBe("captured");
    expect(captured.status).toBe("captured");
    expect(entries.filter((entry) => entry.entryType === "debit")).toHaveLength(
      1,
    );
  });

  it("captures a reservation only once", async () => {
    const { service, entries } = createCreditsFake({
      entries: [{ amount: 10, remainingAmount: 10, expiresAt: null }],
    });

    const reservation = await service.reserveCredits({
      userId: "human-1",
      actionType: "chat_reply",
    });
    await service.captureReservation({ reference: reservation.reference });
    await service.captureReservation({ reference: reservation.reference });

    expect(entries.filter((entry) => entry.entryType === "debit")).toHaveLength(
      1,
    );
  });

  it("refuses to capture an expired reservation and releases it", async () => {
    const { service, entries, reservations } = createCreditsFake({
      entries: [{ amount: 10, remainingAmount: 10, expiresAt: null }],
      reservations: [
        {
          amount: 2,
          reference: "chat_reply:stale",
          expiresAt: new Date("2026-07-14T00:00:00.000Z"),
        },
      ],
    });

    await expect(
      service.captureReservation({ reference: "chat_reply:stale" }),
    ).rejects.toThrow("Credit reservation expired");
    expect(reservations[0].status).toBe("released");
    expect(entries.filter((entry) => entry.entryType === "debit")).toHaveLength(
      0,
    );
  });

  it("grants the signup bonus once per user", async () => {
    const { service, entries } = createCreditsFake();

    const first = await service.grantSignupBonus("human-1");
    const second = await service.grantSignupBonus("human-1");

    expect(second.id).toBe(first.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      entryType: "grant",
      amount: 100,
      remainingAmount: 100,
      externalReference: "signup_bonus:human-1",
    });
    // Free credits carry the 30-day expiry.
    expect(entries[0].expiresAt).toEqual(new Date("2026-08-14T00:00:00.000Z"));
  });

  it("grants daily check-in credits once per KST day", async () => {
    const { service } = createCreditsFake();

    await expect(service.checkIn({ userId: "human-1" })).resolves.toEqual({
      checkInDate: "2026-07-15",
      creditsGranted: 10,
      milestoneBonus: 0,
      monthCheckInCount: 1,
    });
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 10,
      paidBalance: 0,
      freeBalance: 10,
    });
    await expect(service.checkIn({ userId: "human-1" })).rejects.toThrow(
      "Already checked in today",
    );
  });

  it("adds the monthly milestone bonus on the seventh check-in", async () => {
    const { service } = createCreditsFake({
      checkIns: [1, 2, 3, 4, 5, 6].map((day) => ({
        userId: "human-1",
        checkInDate: `2026-07-0${day}`,
      })),
    });

    await expect(service.checkIn({ userId: "human-1" })).resolves.toEqual({
      checkInDate: "2026-07-15",
      creditsGranted: 30,
      milestoneBonus: 20,
      monthCheckInCount: 7,
    });
  });

  it("creates local checkout purchases from the pricing packages", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const create = jest.fn().mockResolvedValue({
      id: "purchase-1",
      userId: "human-1",
      provider: "local",
      status: "pending",
      creditAmount: 1050,
      paidAmount: 9900,
      currency: "KRW",
      createdAt,
      updatedAt: createdAt,
    });
    const service = new (
      CreditsService as new (prisma: unknown) => CreditsService
    )({
      creditPurchase: {
        create,
      },
    });

    await expect(
      service.createCheckout({
        userId: "human-1",
        creditPackageId: "credits_1050",
      }),
    ).resolves.toEqual({
      checkoutId: "purchase-1",
      provider: "local",
      checkoutUrl: "https://payments.local/checkout/purchase-1",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "human-1",
        provider: "local",
        status: "pending",
        creditAmount: 1050,
        paidAmount: 9900,
        currency: "KRW",
      },
    });
    await expect(
      service.createCheckout({
        userId: "human-1",
        creditPackageId: "credits_100",
      }),
    ).rejects.toThrow("Unknown credit package");
  });

  it("disables the local payment stub in production", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const create = jest.fn();
      const checkoutService = new (
        CreditsService as new (prisma: unknown) => CreditsService
      )({ creditPurchase: { create } });

      await expect(
        checkoutService.createCheckout({
          userId: "human-1",
          creditPackageId: "credits_500",
        }),
      ).rejects.toThrow("Payment provider is not configured");
      expect(create).not.toHaveBeenCalled();

      const { service, purchase, prisma } = createPaymentHarness();
      await expect(
        service.handlePaymentWebhook("local", {
          checkoutId: purchase.id,
          status: "paid",
        }),
      ).rejects.toThrow("Payment provider is not configured");
      expect(prisma.$transaction).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it("handles paid local webhooks with an idempotent non-expiring grant", async () => {
    const { service, purchase, entries, creditLedgerEntry } =
      createPaymentHarness();

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).resolves.toEqual({ received: true });
    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).resolves.toEqual({ received: true });
    expect(creditLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([
      expect.objectContaining({
        userId: purchase.userId,
        entryType: "grant",
        amount: purchase.creditAmount,
        remainingAmount: purchase.creditAmount,
        expiresAt: undefined,
        reason: "credit purchase paid",
        externalReference: `credit_purchase:${purchase.id}`,
      }),
    ]);
  });

  it("uses a paid purchase to clear debt before exposing new credits", async () => {
    const { service, prisma, purchase, entries, creditAccount } =
      createPaymentHarness("pending", { paidDebt: 200 });

    await service.handlePaymentWebhook("local", {
      checkoutId: purchase.id,
      status: "paid",
    });

    expect(creditAccount.update).toHaveBeenCalledWith({
      where: { userId: purchase.userId },
      data: { paidDebt: 0 },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: purchase.userId },
      data: { debtIdentityHash: null },
    });
    expect(entries).toEqual([
      expect.objectContaining({
        creditKind: "paid",
        purchaseId: purchase.id,
        amount: 1050,
        remainingAmount: 850,
      }),
    ]);
  });

  it("quotes a user refund when at least half of the purchase remains", async () => {
    const { service } = createPaymentHarness("paid", { existingGrant: true });

    await expect(
      service.getUserRefundQuote({
        userId: "human-1",
        purchaseId: paymentPurchaseId,
      }),
    ).resolves.toMatchObject({
      purchaseId: paymentPurchaseId,
      refundableCredits: 1050,
      grossAmount: 9900,
      feeAmount: 495,
      refundAmount: 9405,
    });
  });

  it.each([
    {
      creditAmount: 500,
      paidAmount: 4900,
      remainingAmount: 250,
      grossAmount: 2450,
      feeAmount: 122,
      refundAmount: 2328,
    },
    {
      creditAmount: 3300,
      paidAmount: 29000,
      remainingAmount: 1700,
      grossAmount: 14939,
      feeAmount: 746,
      refundAmount: 14193,
    },
  ])(
    "rounds the $paidAmount refund example down to won",
    async ({
      creditAmount,
      paidAmount,
      remainingAmount,
      grossAmount,
      feeAmount,
      refundAmount,
    }) => {
      const { service } = createPaymentHarness("paid", {
        existingGrant: true,
        creditAmount,
        paidAmount,
        remainingAmount,
      });

      await expect(
        service.getUserRefundQuote({
          userId: "human-1",
          purchaseId: paymentPurchaseId,
        }),
      ).resolves.toMatchObject({
        refundableCredits: remainingAmount,
        grossAmount,
        feeAmount,
        refundAmount,
      });
    },
  );

  it("rejects a user refund below half, including credits held for use", async () => {
    const belowHalf = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 524,
    });
    await expect(
      belowHalf.service.getUserRefundQuote({
        userId: "human-1",
        purchaseId: paymentPurchaseId,
      }),
    ).resolves.toMatchObject({
      eligible: false,
      refundableCredits: 524,
      grossAmount: 0,
      feeAmount: 0,
      refundAmount: 0,
    });

    const heldForUse = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 600,
      usageReservationAmount: 100,
    });
    await expect(
      heldForUse.service.reserveUserRefund({
        userId: "human-1",
        purchaseId: paymentPurchaseId,
        reference: "refund-request-held",
      }),
    ).rejects.toThrow("At least half");
  });

  it("locks a refund quote and releases it without removing credits", async () => {
    const { service, refunds, entries } = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 525,
    });

    const reserved = await service.reserveUserRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "refund-request-1",
    });
    expect(reserved).toMatchObject({
      status: "reserved",
      creditAmount: 525,
      grossAmount: 4950,
      feeAmount: 247,
      refundAmount: 4703,
    });
    await expect(
      service.reserveUserRefund({
        userId: "human-1",
        purchaseId: paymentPurchaseId,
        reference: "refund-request-1",
      }),
    ).resolves.toMatchObject({ id: reserved.id, status: "reserved" });
    await expect(
      service.getUserRefundQuote({
        userId: "human-1",
        purchaseId: paymentPurchaseId,
      }),
    ).resolves.toMatchObject({
      lockedCredits: 525,
      refundableCredits: 0,
      eligible: false,
    });
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 0,
      paidBalance: 0,
      freeBalance: 0,
    });
    await expect(
      service.spendCredits({
        userId: "human-1",
        amount: 1,
        reason: "must stay locked",
      }),
    ).rejects.toThrow(InsufficientCreditsException);

    await expect(
      service.releaseUserRefund({
        userId: "human-1",
        refundId: reserved.id,
      }),
    ).resolves.toMatchObject({ status: "released" });
    expect(refunds[0].status).toBe("released");
    expect(entries[0].remainingAmount).toBe(525);
  });

  it("confirms a refund once and recovers the locked purchase credits", async () => {
    const { service, purchase, entries } = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 600,
    });
    const reserved = await service.reserveUserRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "refund-request-2",
    });

    await expect(
      service.handleLocalRefundResult({
        refundId: reserved.id,
        status: "succeeded",
      }),
    ).resolves.toMatchObject({
      status: "refunded",
      creditAmount: 600,
      grossAmount: 5657,
      feeAmount: 282,
      refundAmount: 5375,
    });
    await service.handleLocalRefundResult({
      refundId: reserved.id,
      status: "succeeded",
    });

    expect(purchase.status).toBe("refunded");
    expect(entries[0].remainingAmount).toBe(0);
    expect(
      entries.filter(
        (entry) => entry.externalReference === `credit_refund:${reserved.id}`,
      ),
    ).toHaveLength(1);
  });

  it("retries internal recovery without duplicating a successful provider refund", async () => {
    const { service, refunds, entries } = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 600,
      failLedgerCreateTimes: 1,
    });
    const reserved = await service.reserveUserRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "refund-recovery-retry",
    });

    await expect(
      service.handleLocalRefundResult({
        refundId: reserved.id,
        status: "succeeded",
      }),
    ).rejects.toThrow("ledger write failed");
    expect(refunds[0].status).toBe("reserved");
    expect(entries[0].remainingAmount).toBe(600);

    await expect(
      service.handleLocalRefundResult({
        refundId: reserved.id,
        status: "succeeded",
      }),
    ).resolves.toMatchObject({ status: "refunded" });
    expect(entries[0].remainingAmount).toBe(0);
    expect(
      entries.filter(
        (entry) => entry.externalReference === `credit_refund:${reserved.id}`,
      ),
    ).toHaveLength(1);
  });

  it("releases locked credits when the local refund fails", async () => {
    const { service, entries } = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 600,
    });
    const reserved = await service.reserveUserRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "refund-request-3",
    });

    await expect(
      service.handleLocalRefundResult({
        refundId: reserved.id,
        status: "failed",
      }),
    ).resolves.toMatchObject({ status: "released" });
    expect(entries[0].remainingAmount).toBe(600);
  });

  it("includes paid promotions in the user-refund threshold", async () => {
    const { service } = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 475,
      promotionGrants: [
        {
          creditKind: "paid",
          amount: 100,
          remainingAmount: 100,
          promotionCode: "PAID_BONUS",
        },
      ],
    });

    await expect(
      service.getUserRefundQuote({
        userId: "human-1",
        purchaseId: paymentPurchaseId,
      }),
    ).resolves.toMatchObject({
      originalCredits: 1150,
      refundableCredits: 575,
      minimumCredits: 575,
      eligible: true,
      grossAmount: 4950,
      feeAmount: 247,
      refundAmount: 4703,
    });
  });

  it("grants a purchase promotion with its configured credit kind", async () => {
    const { service, entries } = createPaymentHarness("paid", {
      existingGrant: true,
    });

    await service.grantCredits({
      userId: "human-1",
      amount: 100,
      reason: "paid purchase promotion",
      creditKind: "paid",
      purchaseId: paymentPurchaseId,
      promotionCode: "PAID_BONUS",
      externalReference: "promotion:paid-bonus:human-1",
    });

    expect(
      entries.find((entry) => entry.promotionCode === "PAID_BONUS"),
    ).toMatchObject({
      creditKind: "paid",
      purchaseId: paymentPurchaseId,
      amount: 100,
      remainingAmount: 100,
    });
  });

  it("recovers a linked free promotion and records used credits as debt", async () => {
    const { service, entries } = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 600,
      promotionGrants: [
        {
          creditKind: "free",
          amount: 50,
          remainingAmount: 0,
          promotionCode: "FREE_BONUS",
        },
      ],
    });
    const refund = await service.reserveUserRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "refund-with-free-promotion",
    });
    expect(refund).toMatchObject({
      creditAmount: 600,
      promotionAmount: 50,
      reason: "user_request",
    });

    await service.handleLocalRefundResult({
      refundId: refund.id,
      status: "succeeded",
    });

    expect(
      entries.find((entry) => entry.promotionCode === "FREE_BONUS"),
    ).toMatchObject({ remainingAmount: 0 });
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: -50,
      paidBalance: -50,
    });
  });

  it("refunds company fault without a fee and preserves purchase bonuses", async () => {
    const { service, entries } = createPaymentHarness("paid", {
      existingGrant: true,
      remainingAmount: 350,
      promotionGrants: [
        {
          creditKind: "free",
          amount: 50,
          remainingAmount: 50,
          promotionCode: "COMPANY_BONUS",
        },
      ],
    });

    const refund = await service.reserveCompanyFaultRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "company-fault-refund",
    });
    expect(refund).toMatchObject({
      reason: "company_fault",
      creditAmount: 1050,
      promotionAmount: 0,
      grossAmount: 9900,
      feeAmount: 0,
      refundAmount: 9900,
    });
    await service.handleLocalRefundResult({
      refundId: refund.id,
      status: "succeeded",
    });

    expect(
      entries.find((entry) => entry.promotionCode === "COMPANY_BONUS"),
    ).toMatchObject({ remainingAmount: 50 });
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: -700,
      paidBalance: -700,
    });
  });

  it("refunds a company-fault payment even when credits were never granted", async () => {
    const { service, entries } = createPaymentHarness("paid");
    const refund = await service.reserveCompanyFaultRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "company-fault-missing-grant",
    });

    expect(refund).toMatchObject({
      creditAmount: 0,
      promotionAmount: 0,
      refundAmount: 9900,
    });
    await service.handleLocalRefundResult({
      refundId: refund.id,
      status: "succeeded",
    });
    expect(entries).toHaveLength(0);
  });

  it("refunds a company price adjustment without changing credits", async () => {
    const { service, purchase, entries } = createPaymentHarness("paid", {
      existingGrant: true,
    });
    const refund = await service.reserveCompanyPriceAdjustmentRefund({
      userId: "human-1",
      purchaseId: paymentPurchaseId,
      reference: "company-price-adjustment",
      refundAmount: 1000,
    });

    expect(refund).toMatchObject({
      reason: "company_price_adjustment",
      creditAmount: 0,
      refundAmount: 1000,
    });
    await service.handleLocalRefundResult({
      refundId: refund.id,
      status: "succeeded",
    });
    expect(purchase.status).toBe("paid");
    expect(entries).toHaveLength(1);
    expect(entries[0].remainingAmount).toBe(1050);
    await expect(
      service.reserveCompanyFaultRefund({
        userId: "human-1",
        purchaseId: paymentPurchaseId,
        reference: "company-fault-after-adjustment",
      }),
    ).resolves.toMatchObject({ refundAmount: 8900 });
  });

  it("rolls back a paid transition when its ledger grant fails", async () => {
    const { service, purchase } = createPaymentHarness("pending", {
      failGrant: true,
    });

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).rejects.toThrow("ledger write failed");
    expect(purchase.status).toBe("pending");
  });

  it.each([
    ["paid", "failed"],
    ["failed", "paid"],
    ["canceled", "paid"],
    ["pending", "refunded"],
  ] as const)(
    "rejects the payment transition %s -> %s",
    async (currentStatus, nextStatus) => {
      const { service, purchase, entries } =
        createPaymentHarness(currentStatus);

      await expect(
        service.handlePaymentWebhook("local", {
          checkoutId: purchase.id,
          status: nextStatus,
        }),
      ).rejects.toThrow("Credit purchase status conflict");
      expect(purchase.status).toBe(currentStatus);
      expect(entries).toHaveLength(0);
    },
  );

  it("treats an exact paid replay as a no-op", async () => {
    const { service, purchase, entries, creditLedgerEntry, creditPurchase } =
      createPaymentHarness("paid", { existingGrant: true });

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).resolves.toEqual({ received: true });
    expect(creditPurchase.update).not.toHaveBeenCalled();
    expect(creditLedgerEntry.create).not.toHaveBeenCalled();
    expect(entries).toHaveLength(1);
  });

  it("repairs a missing grant when an already-paid webhook is replayed", async () => {
    const { service, purchase, entries, creditLedgerEntry, creditPurchase } =
      createPaymentHarness("paid");

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).resolves.toEqual({ received: true });
    expect(creditPurchase.update).not.toHaveBeenCalled();
    expect(creditLedgerEntry.create).toHaveBeenCalledTimes(1);
    expect(entries).toEqual([
      expect.objectContaining({
        userId: purchase.userId,
        amount: purchase.creditAmount,
        reason: "credit purchase paid",
        externalReference: `credit_purchase:${purchase.id}`,
      }),
    ]);
  });

  it("rejects a paid replay when its existing grant conflicts", async () => {
    const { service, purchase, entries, creditLedgerEntry, creditPurchase } =
      createPaymentHarness("paid", { existingGrant: true });
    entries[0].amount = purchase.creditAmount - 1;

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).rejects.toThrow("Credit grant reference conflict");
    expect(creditPurchase.update).not.toHaveBeenCalled();
    expect(creditLedgerEntry.create).not.toHaveBeenCalled();
  });

  it("rejects refunded webhooks even when the purchase is already refunded", async () => {
    const { service, purchase, creditPurchase } =
      createPaymentHarness("refunded");

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "refunded",
      }),
    ).rejects.toThrow("Credit purchase status conflict");
    expect(creditPurchase.update).not.toHaveBeenCalled();
  });

  it.each([
    ["human-2", 1050],
    ["human-1", 500],
  ] as const)(
    "rejects reusing a grant reference for user %s and amount %s",
    async (userId, amount) => {
      const { service } = createPaymentHarness("paid", {
        existingGrant: true,
      });

      await expect(
        service.grantCredits({
          userId,
          amount,
          reason: "credit purchase paid",
          externalReference: `credit_purchase:${paymentPurchaseId}`,
        }),
      ).rejects.toThrow("Credit grant reference conflict");
    },
  );

  it("returns a cursor page of ledger entries", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const grantRow = {
      id: "grant-1",
      userId: "human-1",
      entryType: "grant" as const,
      amount: 100,
      remainingAmount: 75,
      expiresAt: null,
      reason: "admin grant",
      externalReference: null,
      createdAt,
    };
    const debitRow = {
      ...grantRow,
      id: "debit-1",
      entryType: "debit" as const,
      amount: 25,
      remainingAmount: null,
      reason: "message",
    };
    const findMany = jest.fn().mockResolvedValue([grantRow, debitRow]);
    const service = new (
      CreditsService as new (prisma: unknown) => CreditsService
    )({
      creditLedgerEntry: {
        findMany,
      },
    });

    const page = await service.listEntriesPage("human-1", { limit: 1 });

    expect(page.items).toEqual([
      {
        id: "grant-1",
        userId: "human-1",
        entryType: "grant",
        amount: 100,
        remainingAmount: 75,
        expiresAt: undefined,
        reason: "admin grant",
        externalReference: undefined,
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "human-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2,
    });
  });

  it("returns a cursor page of credit purchases", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const firstPurchase = {
      id: "purchase-2",
      userId: "human-1",
      provider: "local",
      status: "paid" as const,
      creditAmount: 1050,
      paidAmount: 9900,
      currency: "KRW",
      createdAt,
      updatedAt: createdAt,
    };
    const secondPurchase = {
      ...firstPurchase,
      id: "purchase-1",
      status: "pending" as const,
      creditAmount: 500,
      paidAmount: 4900,
      currency: "KRW",
    };
    const findMany = jest
      .fn()
      .mockResolvedValue([firstPurchase, secondPurchase]);
    const service = new (
      CreditsService as new (prisma: unknown) => CreditsService
    )({
      creditPurchase: {
        findMany,
      },
    });

    await expect(
      service.listPurchasesPage("human-1", { limit: 1 }),
    ).resolves.toEqual({
      items: [
        {
          id: "purchase-2",
          provider: "local",
          status: "paid",
          creditAmount: 1050,
          paidAmount: 9900,
          currency: "KRW",
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
  });

  it("requires explicit reason fields", async () => {
    const service = new (
      CreditsService as new (prisma: unknown) => CreditsService
    )({ creditLedgerEntry: {} });

    await expect(
      service.spendCredits({
        userId: "human-1",
        amount: 10,
        reason: " ",
      }),
    ).rejects.toThrow("Credit ledger reason is required");
  });

  it("returns a validation error when a ledger reason is missing", async () => {
    const { service } = createCreditsFake();

    await expect(
      service.spendCredits({
        userId: "human-1",
        amount: 10,
        reason: undefined as unknown as string,
      }),
    ).rejects.toThrow("Credit ledger reason is required");
  });

  it("returns a validation error when the webhook body is missing", async () => {
    const { service } = createPaymentHarness();

    await expect(
      service.handlePaymentWebhook(
        "local",
        undefined as unknown as Parameters<
          CreditsService["handlePaymentWebhook"]
        >[1],
      ),
    ).rejects.toThrow("Payment checkout ID is required");
  });

  it("returns a validation error when the webhook checkout ID is not a string", async () => {
    const { service } = createPaymentHarness();

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: 123,
        status: "paid",
      } as unknown as Parameters<CreditsService["handlePaymentWebhook"]>[1]),
    ).rejects.toThrow("Payment checkout ID is required");
  });

  it("rejects malformed webhook checkout IDs before starting a transaction", async () => {
    const { service, prisma } = createPaymentHarness();

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: "bad-id",
        status: "paid",
      }),
    ).rejects.toThrow("Payment checkout ID is invalid");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects spending beyond the balance with a payment-required error", async () => {
    const { service } = createCreditsFake();

    await expect(
      service.spendCredits({
        userId: "human-1",
        amount: 1,
        reason: "message",
      }),
    ).rejects.toThrow(InsufficientCreditsException);
  });
});
