import { ReportsService } from "./reports.service";

describe("ReportsService", () => {
  it("creates submitted reports for existing posts", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const reportRow = {
      id: "report-1",
      reporterUserId: "human-1",
      targetType: "post" as const,
      targetId: "post-1",
      reason: "unsafe content",
      details: null,
      status: "submitted" as const,
      createdAt,
      updatedAt: createdAt,
    };
    const create = jest.fn().mockResolvedValue(reportRow);
    const postFindUnique = jest.fn().mockResolvedValue({ id: "post-1" });
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
        targetId: "post-1",
        reason: " unsafe content ",
        details: " ",
      }),
    ).resolves.toEqual({
      id: "report-1",
      status: "submitted",
      createdAt: createdAt.toISOString(),
    });
    expect(postFindUnique).toHaveBeenCalledWith({
      where: { id: "post-1" },
      select: { id: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        reporterUserId: "human-1",
        targetType: "post",
        targetId: "post-1",
        reason: "unsafe content",
        details: null,
        status: "submitted",
      },
    });
  });

  it("finds a report detail owned by a user", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const updatedAt = new Date("2026-07-02T01:00:00.000Z");
    const findFirst = jest.fn().mockResolvedValue({
      id: "report-1",
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
        reportId: "report-1",
      }),
    ).resolves.toEqual({
      id: "report-1",
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
      where: { id: "report-1", reporterUserId: "human-1" },
    });
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

  it("rejects missing targets", async () => {
    const service = new (
      ReportsService as new (prisma: unknown) => ReportsService
    )({
      post: { findUnique: jest.fn().mockResolvedValue(null) },
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
  });
});
