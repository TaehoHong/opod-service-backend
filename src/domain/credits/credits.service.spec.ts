import { ConflictException } from "@nestjs/common";
import { CreditsService } from "./credits.service";

describe("CreditsService", () => {
  const row = {
    id: "01980000-0000-7000-8000-000000000001",
    userId: "01980000-0000-7000-8000-000000000002",
    type: "grant" as const,
    creditKind: "paid" as const,
    purchaseId: "01980000-0000-7000-8000-000000000003",
    promotionCode: null,
    amount: 500,
    expiresAt: null,
    reason: "credit purchase",
    externalReference: "credit_purchase:purchase-1",
    createdAt: new Date("2026-08-04T00:00:00Z"),
  };

  function harness(existing: typeof row | null = null) {
    const client = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      creditLedger: {
        findUnique: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockResolvedValue(row),
      },
    };
    const prisma = {
      ...client,
      $transaction: jest.fn(async (work: (tx: typeof client) => unknown) =>
        work(client),
      ),
    };
    return {
      client,
      service: new CreditsService(prisma as never),
    };
  }

  it("requires every paid grant to reference its purchase", async () => {
    const { service } = harness();
    await expect(
      service.grantCredits({
        userId: row.userId,
        amount: 500,
        reason: "credit purchase",
        creditKind: "paid",
      }),
    ).rejects.toThrow("Paid credits require a purchase ID");
  });

  it("returns the existing grant for an identical replay", async () => {
    const { service, client } = harness(row);
    await expect(
      service.grantCredits({
        userId: row.userId,
        amount: row.amount,
        reason: row.reason,
        creditKind: row.creditKind,
        purchaseId: row.purchaseId,
        externalReference: row.externalReference,
      }),
    ).resolves.toMatchObject({ id: row.id, type: "grant", amount: 500 });
    expect(client.creditLedger.create).not.toHaveBeenCalled();
  });

  it("rejects reuse of a grant reference with different facts", async () => {
    const { service } = harness(row);
    await expect(
      service.grantCredits({
        userId: row.userId,
        amount: 1050,
        reason: row.reason,
        creditKind: row.creditKind,
        purchaseId: row.purchaseId,
        externalReference: row.externalReference,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
