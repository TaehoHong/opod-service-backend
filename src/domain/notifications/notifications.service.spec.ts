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
    const readAt = new Date("2026-07-02T01:00:00.000Z");
    const findFirst = jest.fn().mockResolvedValue({ id: "notification-1" });
    const update = jest.fn().mockResolvedValue({
      id: "notification-1",
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
        notificationId: "notification-1",
      }),
    ).resolves.toEqual({
      id: "notification-1",
      readAt: readAt.toISOString(),
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "notification-1", userId: "human-1" },
      select: { id: true },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "notification-1" },
      data: { readAt: expect.any(Date) },
      select: { id: true, readAt: true },
    });
  });
});
