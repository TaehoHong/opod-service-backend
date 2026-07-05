import { CreditsService } from "./credits.service";

describe("CreditsService", () => {
  it("spends and reads ledger entries through Prisma", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const grantRow = {
      id: "grant-1",
      userId: "human-1",
      entryType: "grant" as const,
      amount: 100,
      reason: "admin grant",
      externalReference: null,
      createdAt,
    };
    const debitRow = {
      id: "debit-1",
      userId: "human-1",
      entryType: "debit" as const,
      amount: 25,
      reason: "message",
      externalReference: null,
      createdAt,
    };
    const create = jest.fn().mockResolvedValueOnce(debitRow);
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([grantRow])
      .mockResolvedValueOnce([grantRow, debitRow])
      .mockResolvedValueOnce([grantRow, debitRow]);
    const service = new (
      CreditsService as new (prisma: unknown) => CreditsService
    )({
      creditLedgerEntry: {
        create,
        findMany,
      },
    });

    await expect(
      service.spendCredits({
        userId: "human-1",
        amount: 25,
        reason: "message",
      }),
    ).resolves.toEqual({
      ...debitRow,
      externalReference: undefined,
      createdAt: createdAt.toISOString(),
    });
    await expect(service.getBalance("human-1")).resolves.toEqual({
      userId: "human-1",
      balance: 75,
    });
    await expect(service.listEntries("human-1")).resolves.toEqual([
      {
        ...grantRow,
        externalReference: undefined,
        createdAt: createdAt.toISOString(),
      },
      {
        ...debitRow,
        externalReference: undefined,
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "human-1",
        entryType: "debit",
        amount: 25,
        reason: "message",
        externalReference: undefined,
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
      reason: "admin grant",
      externalReference: null,
      createdAt,
    };
    const debitRow = {
      ...grantRow,
      id: "debit-1",
      entryType: "debit" as const,
      amount: 25,
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
        ...grantRow,
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
      creditAmount: 100,
      paidAmount: 9900,
      currency: "KRW",
      createdAt,
      updatedAt: createdAt,
    };
    const secondPurchase = {
      ...firstPurchase,
      id: "purchase-1",
      status: "pending" as const,
      creditAmount: 50,
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
          creditAmount: 100,
          paidAmount: 9900,
          currency: "KRW",
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "human-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
    });
  });

  it("creates local checkout purchases", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const create = jest.fn().mockResolvedValue({
      id: "purchase-1",
      userId: "human-1",
      provider: "local",
      status: "pending",
      creditAmount: 100,
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
        creditPackageId: "credits_100",
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
        creditAmount: 100,
        paidAmount: 9900,
        currency: "KRW",
      },
    });
  });

  it("handles paid local webhooks with an idempotent credit grant", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const purchase = {
      id: "purchase-1",
      userId: "human-1",
      provider: "local",
      status: "pending" as const,
      creditAmount: 100,
      paidAmount: 9900,
      currency: "KRW",
      createdAt,
      updatedAt: createdAt,
    };
    const update = jest.fn().mockResolvedValue({ ...purchase, status: "paid" });
    const ledgerFindFirst = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "grant-1" });
    const ledgerCreate = jest.fn().mockResolvedValue({
      id: "grant-1",
      userId: "human-1",
      entryType: "grant",
      amount: 100,
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
    expect(update).toHaveBeenCalledWith({
      where: { id: "purchase-1" },
      data: { status: "paid" },
    });
    expect(ledgerCreate).toHaveBeenCalledWith({
      data: {
        userId: "human-1",
        entryType: "grant",
        amount: 100,
        reason: "credit purchase paid",
        externalReference: "credit_purchase:purchase-1",
      },
    });
    expect(ledgerCreate).toHaveBeenCalledTimes(1);
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

  it("rejects insufficient balance", async () => {
    const service = new (
      CreditsService as new (prisma: unknown) => CreditsService
    )({
      creditLedgerEntry: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });

    await expect(
      service.spendCredits({
        userId: "human-1",
        amount: 1,
        reason: "message",
      }),
    ).rejects.toThrow("Insufficient credits");
  });
});
