import { CreditsService } from "./credits.service";
import { InsufficientCreditsException } from "./insufficient-credits.exception";

type LedgerRow = {
  id: string;
  userId: string;
  entryType: "grant" | "debit";
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

// In-memory stand-in for the Prisma queries the credits service issues, so
// tests exercise reserve/capture/release and bucket consumption end to end.
function createCreditsFake(seed?: {
  entries?: Partial<LedgerRow>[];
  reservations?: Partial<ReservationRow>[];
  checkIns?: Partial<CheckInRow>[];
}) {
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}-${(sequence += 1)}`;

  const entries: LedgerRow[] = (seed?.entries ?? []).map((entry) => ({
    id: nextId("entry"),
    userId: "human-1",
    entryType: "grant",
    amount: 0,
    remainingAmount: null,
    expiresAt: null,
    reason: "seed",
    externalReference: null,
    createdAt: new Date(),
    ...entry,
  }));
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
    creditLedgerEntry: {
      aggregate: jest.fn(async ({ where }: { where: { userId: string } }) => ({
        _sum: {
          remainingAmount: entries
            .filter(
              (entry) =>
                entry.userId === where.userId &&
                isActiveGrant(entry, new Date()),
            )
            .reduce((sum, entry) => sum + (entry.remainingAmount ?? 0), 0),
        },
      })),
      findMany: jest.fn(
        async ({
          where,
        }: {
          where: { userId: string; remainingAmount?: { gt: number } };
        }) => {
          const rows = entries.filter((entry) => entry.userId === where.userId);
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
              if (first.expiresAt === null && second.expiresAt === null) {
                return first.createdAt.getTime() - second.createdAt.getTime();
              }
              if (first.expiresAt === null) {
                return 1;
              }
              if (second.expiresAt === null) {
                return -1;
              }
              return (
                first.expiresAt.getTime() - second.expiresAt.getTime() ||
                first.createdAt.getTime() - second.createdAt.getTime()
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
          where: { reference: string; status: ReservationRow["status"] };
          data: Partial<ReservationRow>;
        }) => {
          const rows = reservations.filter(
            (reservation) =>
              reservation.reference === where.reference &&
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
    });
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

  it("handles paid local webhooks with an idempotent non-expiring grant", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const purchase = {
      id: "purchase-1",
      userId: "human-1",
      provider: "local",
      status: "pending" as const,
      creditAmount: 1050,
      paidAmount: 9900,
      currency: "KRW",
      createdAt,
      updatedAt: createdAt,
    };
    const update = jest.fn().mockResolvedValue({ ...purchase, status: "paid" });
    const ledgerFindFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "grant-1",
        userId: "human-1",
        entryType: "grant",
        amount: 1050,
        remainingAmount: 1050,
        expiresAt: null,
        reason: "credit purchase paid",
        externalReference: "credit_purchase:purchase-1",
        createdAt,
      });
    const ledgerCreate = jest.fn().mockResolvedValue({
      id: "grant-1",
      userId: "human-1",
      entryType: "grant",
      amount: 1050,
      remainingAmount: 1050,
      expiresAt: null,
      reason: "credit purchase paid",
      externalReference: "credit_purchase:purchase-1",
      createdAt,
    });
    const service = new (
      CreditsService as new (prisma: unknown) => CreditsService
    )({
      creditLedgerEntry: {
        create: ledgerCreate,
        findFirst: ledgerFindFirst,
      },
      creditPurchase: {
        findUnique: jest.fn().mockResolvedValue(purchase),
        update,
      },
    });

    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: "purchase-1",
        status: "paid",
      }),
    ).resolves.toEqual({ received: true });
    await expect(
      service.handlePaymentWebhook("local", {
        checkoutId: "purchase-1",
        status: "paid",
      }),
    ).resolves.toEqual({ received: true });
    expect(ledgerCreate).toHaveBeenCalledTimes(1);
    expect(ledgerCreate).toHaveBeenCalledWith({
      data: {
        userId: "human-1",
        entryType: "grant",
        amount: 1050,
        remainingAmount: 1050,
        expiresAt: undefined,
        reason: "credit purchase paid",
        externalReference: "credit_purchase:purchase-1",
      },
    });
  });

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
