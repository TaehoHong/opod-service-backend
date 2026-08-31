import { BadRequestException } from "@nestjs/common";
import { queryReturning } from "../../../test/drizzle-mock";
import { InquiriesService } from "./inquiries.service";

function createHarness(countToday = 0) {
  const createdAt = new Date("2026-07-14T12:00:00.000Z");
  const countQuery = queryReturning([{ value: countToday }]);
  const insertQuery = queryReturning([
    {
      id: "019f4970-b34a-7035-ad98-dfea56b2974e",
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
      status: "submitted",
      answerBody: null,
      answeredAt: null,
      createdAt,
    },
  ]);
  const client = {
    execute: jest.fn().mockResolvedValue(undefined),
    insert: jest.fn().mockReturnValue(insertQuery),
    select: jest.fn().mockReturnValue(countQuery),
    transaction: jest.fn(),
  };
  client.transaction.mockImplementation(
    async (run: (tx: typeof client) => Promise<unknown>) => run(client),
  );
  const service = new (
    InquiriesService as new (database: unknown) => InquiriesService
  )({ client });
  return { client, countQuery, insertQuery, service };
}

describe("InquiriesService", () => {
  it("creates a submitted inquiry with a trimmed body", async () => {
    const { insertQuery, service } = createHarness();

    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "credit",
        body: "  결제했는데 크레딧이 안 들어와요.  ",
      }),
    ).resolves.toMatchObject({
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
      status: "submitted",
    });
    expect(insertQuery.values).toHaveBeenCalledWith({
      userId: "user-1",
      category: "credit",
      body: "결제했는데 크레딧이 안 들어와요.",
    });
  });

  it("rejects invalid categories and bodies before opening a transaction", async () => {
    const { client, service } = createHarness();

    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "unknown",
        body: "hello",
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.createInquiry({ userId: "user-1", category: "etc", body: "  " }),
    ).rejects.toThrow("body is required");
    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "etc",
        body: "x".repeat(2001),
      }),
    ).rejects.toThrow("body must be at most 2000 characters");
    expect(client.transaction).not.toHaveBeenCalled();
  });

  it("rejects the eleventh inquiry after acquiring the user lock", async () => {
    const { client, service } = createHarness(10);

    await expect(
      service.createInquiry({
        userId: "user-1",
        category: "etc",
        body: "11번째 문의",
      }),
    ).rejects.toMatchObject({ status: 429 });
    expect(client.execute).toHaveBeenCalledTimes(1);
    expect(client.insert).not.toHaveBeenCalled();
  });

  it("calculates the KST day after the transaction lock resolves", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-14T14:59:59.000Z"));
    try {
      const { client, service } = createHarness();
      client.execute.mockImplementationOnce(async () => {
        jest.setSystemTime(new Date("2026-07-14T15:00:01.000Z"));
      });

      await service.createInquiry({
        userId: "user-1",
        category: "credit",
        body: "자정 경계 문의",
      });

      expect(client.execute).toHaveBeenCalledTimes(1);
      expect(client.select).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
