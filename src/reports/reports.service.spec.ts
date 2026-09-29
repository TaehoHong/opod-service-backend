import { ReportsService } from "./reports.service";

function queryReturning<T>(rows: T) {
  const promise = Promise.resolve(rows);
  const query = {
    from: jest.fn(),
    innerJoin: jest.fn(),
    limit: jest.fn(),
    returning: jest.fn(),
    then: promise.then.bind(promise),
    values: jest.fn(),
    where: jest.fn(),
  };
  for (const method of [
    query.from,
    query.innerJoin,
    query.limit,
    query.returning,
    query.values,
    query.where,
  ]) {
    method.mockReturnValue(query);
  }
  return query;
}

function serviceWith(client: Record<string, unknown>): ReportsService {
  return new (ReportsService as new (database: unknown) => ReportsService)({
    client,
  });
}

describe("ReportsService", () => {
  it("creates submitted reports for existing posts", async () => {
    const postId = "019f4970-b34a-7035-ad98-dfea56b2974e";
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const reportRow = {
      id: "report-1",
      reporterUserId: "human-1",
      targetType: "post" as const,
      targetId: postId,
      reason: "unsafe content",
      details: null,
      resolution: null,
      status: "submitted" as const,
      createdAt,
      updatedAt: createdAt,
    };
    const findPost = queryReturning([{ id: postId }]);
    const createReport = queryReturning([reportRow]);
    const service = serviceWith({
      insert: jest.fn().mockReturnValue(createReport),
      select: jest.fn().mockReturnValue(findPost),
    });

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId: postId,
        reason: " unsafe content ",
        details: " ",
      }),
    ).resolves.toEqual({
      id: "report-1",
      status: "submitted",
      createdAt: createdAt.toISOString(),
    });
    expect(createReport.values).toHaveBeenCalledWith({
      reporterUserId: "human-1",
      targetType: "post",
      targetId: postId,
      reason: "unsafe content",
      details: null,
      status: "submitted",
    });
    expect(createReport.returning).toHaveBeenCalledTimes(1);
  });

  it("finds a report detail owned by a user", async () => {
    const reportId = "019f4970-b34a-7035-ad98-dfea56b2974c";
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const updatedAt = new Date("2026-07-02T01:00:00.000Z");
    const findReport = queryReturning([
      {
        id: reportId,
        reporterUserId: "human-1",
        targetType: "post",
        targetId: "post-1",
        reason: "unsafe content",
        details: "needs review",
        resolution: null,
        status: "reviewing",
        createdAt,
        updatedAt,
      },
    ]);
    const service = serviceWith({
      select: jest.fn().mockReturnValue(findReport),
    });

    await expect(
      service.findReportForUser({
        userId: "human-1",
        reportId,
      }),
    ).resolves.toEqual({
      id: reportId,
      targetType: "post",
      targetId: "post-1",
      reason: "unsafe content",
      details: "needs review",
      resolution: null,
      status: "reviewing",
      createdAt: createdAt.toISOString(),
      updatedAt: updatedAt.toISOString(),
    });
    expect(findReport.limit).toHaveBeenCalledWith(1);
  });

  it("treats malformed report IDs as missing without querying Drizzle", async () => {
    const select = jest.fn();
    const service = serviceWith({ select });

    await expect(
      service.findReportForUser({
        userId: "human-1",
        reportId: "bad-id",
      }),
    ).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("rejects blank reasons", async () => {
    const service = serviceWith({});

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId: "post-1",
        reason: " ",
      }),
    ).rejects.toThrow("Report reason is required");
  });

  it("rejects non-string report fields with validation errors", async () => {
    const service = serviceWith({});

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId: 123,
        reason: "unsafe content",
      } as unknown as Parameters<ReportsService["createReport"]>[0]),
    ).rejects.toThrow("Report target is required");
    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId: "019f4970-b34a-7035-ad98-dfea56b2974e",
        reason: 123,
      } as unknown as Parameters<ReportsService["createReport"]>[0]),
    ).rejects.toThrow("Report reason is required");
    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId: "019f4970-b34a-7035-ad98-dfea56b2974e",
        reason: "unsafe content",
        details: 123,
      } as unknown as Parameters<ReportsService["createReport"]>[0]),
    ).rejects.toThrow("Report details must be a string");
  });

  it("rejects missing target IDs", async () => {
    const service = serviceWith({});

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        reason: "unsafe content",
      } as Parameters<ReportsService["createReport"]>[0]),
    ).rejects.toThrow("Report target is required");
  });

  it("rejects malformed target IDs without querying Drizzle", async () => {
    const select = jest.fn();
    const service = serviceWith({ insert: jest.fn(), select });

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId: "missing-post",
        reason: "unsafe content",
      }),
    ).rejects.toThrow("Report target not found");
    expect(select).not.toHaveBeenCalled();
  });

  it("rejects valid target IDs that do not exist", async () => {
    const targetId = "019f4970-b34a-7035-ad98-dfea56b2974e";
    const findTarget = queryReturning([]);
    const select = jest.fn().mockReturnValue(findTarget);
    const service = serviceWith({ insert: jest.fn(), select });

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId,
        reason: "unsafe content",
      }),
    ).rejects.toThrow("Report target not found");
    expect(select).toHaveBeenCalledTimes(1);
  });
});
