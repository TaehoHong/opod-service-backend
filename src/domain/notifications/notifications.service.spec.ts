import { NotificationsService } from "./notifications.service";

describe("NotificationsService", () => {
  it("lists unread notifications with cursor pagination", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "notification-1",
        userId: "human-1",
        type: "report_update",
        title: "Report updated",
        body: "Your report is being reviewed.",
        targetType: "report",
        targetId: "report-1",
        readAt: null,
        createdAt,
      },
      {
        id: "notification-2",
        userId: "human-1",
        type: "message",
        title: "New message",
        body: null,
        targetType: null,
        targetId: null,
        readAt: null,
        createdAt,
      },
    ]);
    const service = new NotificationsService({
      notification: { findFirst: jest.fn(), findMany },
    } as never);

    await expect(
      service.listNotificationsPage({
        userId: "human-1",
        unreadOnly: true,
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "notification-1",
          type: "report_update",
          title: "Report updated",
          body: "Your report is being reviewed.",
          targetType: "report",
          targetId: "report-1",
          readAt: null,
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "human-1", readAt: null },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
    });
  });

  it("marks an owned notification as read", async () => {
    const notificationId = "019f4970-b34a-7035-ad98-dfea56b2974d";
    const readAt = new Date("2026-07-02T01:00:00.000Z");
    const findFirst = jest.fn().mockResolvedValue({ id: notificationId });
    const update = jest.fn().mockResolvedValue({
      id: notificationId,
      readAt,
    });
    const service = new NotificationsService({
      notification: { findFirst, findMany: jest.fn(), update },
    } as never) as NotificationsService & {
      markNotificationRead(input: {
        userId: string;
        notificationId: string;
      }): Promise<unknown>;
    };

    await expect(
      service.markNotificationRead({
        userId: "human-1",
        notificationId,
      }),
    ).resolves.toEqual({
      id: notificationId,
      readAt: readAt.toISOString(),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: notificationId, userId: "human-1" },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: notificationId },
      data: { readAt: expect.any(Date) },
      select: { id: true, readAt: true },
    });
  });

  it("treats malformed notification IDs as missing without querying Prisma", async () => {
    const findFirst = jest.fn();
    const service = new NotificationsService({
      notification: { findFirst },
    } as never);

    await expect(
      service.markNotificationRead({
        userId: "human-1",
        notificationId: "bad-id",
      }),
    ).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects malformed notification cursors without querying Prisma", async () => {
    const findFirst = jest.fn();
    const findMany = jest.fn();
    const service = new NotificationsService({
      notification: { findFirst, findMany },
    } as never);
    const cursor = Buffer.from(JSON.stringify({ id: "bad-id" })).toString(
      "base64url",
    );

    await expect(
      service.listNotificationsPage({
        userId: "human-1",
        limit: 20,
        cursor,
      }),
    ).rejects.toThrow("Invalid cursor");
    expect(findFirst).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});
