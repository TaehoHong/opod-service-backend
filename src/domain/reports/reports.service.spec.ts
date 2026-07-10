import { ReportsService } from "./reports.service";

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
      status: "submitted" as const,
      createdAt,
      updatedAt: createdAt,
    };
    const create = jest.fn().mockResolvedValue(reportRow);
    const postFindUnique = jest.fn().mockResolvedValue({ id: postId });
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({
      character: { findUnique: jest.fn() },
      message: { findFirst: jest.fn() },
      post: { findUnique: postFindUnique },
      report: { create },
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
    expect(postFindUnique).toHaveBeenCalledWith({
      where: { id: postId },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        reporterUserId: "human-1",
        targetType: "post",
        targetId: postId,
        reason: "unsafe content",
        details: null,
        status: "submitted",
      },
    });
  });

  it("finds a report detail owned by a user", async () => {
    const reportId = "019f4970-b34a-7035-ad98-dfea56b2974c";
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const updatedAt = new Date("2026-07-02T01:00:00.000Z");
    const findFirst = jest.fn().mockResolvedValue({
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
    });
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({
      report: { findFirst },
    }) as ReportsService & {
      findReportForUser(input: {
        userId: string;
        reportId: string;
      }): Promise<unknown>;
    };

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
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: reportId, reporterUserId: "human-1" },
    });
  });

  it("treats malformed report IDs as missing without querying Prisma", async () => {
    const findFirst = jest.fn();
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({ report: { findFirst } });

    await expect(
      service.findReportForUser({
        userId: "human-1",
        reportId: "bad-id",
      }),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects blank reasons", async () => {
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({ report: {} });

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
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({ report: {} });

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
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({ report: {} });

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        reason: "unsafe content",
      } as Parameters<ReportsService["createReport"]>[0]),
    ).rejects.toThrow("Report target is required");
  });

  it("rejects malformed target IDs without querying Prisma", async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({
      post: { findUnique },
      report: { create: jest.fn() },
    });

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId: "missing-post",
        reason: "unsafe content",
      }),
    ).rejects.toThrow("Report target not found");
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("rejects valid target IDs that do not exist", async () => {
    const targetId = "019f4970-b34a-7035-ad98-dfea56b2974e";
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({
      post: { findUnique },
      report: { create: jest.fn() },
    });

    await expect(
      service.createReport({
        userId: "human-1",
        targetType: "post",
        targetId,
        reason: "unsafe content",
      }),
    ).rejects.toThrow("Report target not found");
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: targetId },
      select: { id: true },
    });
  });
});
