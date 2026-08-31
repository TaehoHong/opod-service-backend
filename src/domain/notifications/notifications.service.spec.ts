import { queryReturning } from "../../../test/drizzle-mock";
import { NOTIFICATION_TYPES } from "./notification-types";
import { NotificationsService } from "./notifications.service";

function serviceWith(client: Record<string, unknown>): NotificationsService {
  return new (
    NotificationsService as new (database: unknown) => NotificationsService
  )({ client });
}

describe("NotificationsService", () => {
  it("creates notifications with the caller's Drizzle transaction", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const query = queryReturning([
      {
        id: "notification-1",
        userId: "human-1",
        type: NOTIFICATION_TYPES.characterNewPost,
        title: "새 게시글",
        body: null,
        targetType: "post",
        targetId: "post-1",
        readAt: null,
        createdAt,
      },
    ]);
    const insert = jest.fn().mockReturnValue(query);
    const service = serviceWith({});

    await expect(
      service.createNotificationWithClient({ insert } as never, {
        userId: "human-1",
        type: NOTIFICATION_TYPES.characterNewPost,
        title: "새 게시글",
        targetType: "post",
        targetId: "post-1",
      }),
    ).resolves.toEqual({
      id: "notification-1",
      type: NOTIFICATION_TYPES.characterNewPost,
      title: "새 게시글",
      body: null,
      targetType: "post",
      targetId: "post-1",
      readAt: null,
      createdAt: createdAt.toISOString(),
    });
    expect(query.values).toHaveBeenCalledWith({
      userId: "human-1",
      type: NOTIFICATION_TYPES.characterNewPost,
      title: "새 게시글",
      targetType: "post",
      targetId: "post-1",
    });
  });

  it("lists unread notifications with cursor pagination", async () => {
    const createdAt = new Date("2026-07-02T00:00:00.000Z");
    const query = queryReturning([
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
    const service = serviceWith({
      select: jest.fn().mockReturnValue(query),
    });

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
    expect(query.limit).toHaveBeenCalledWith(2);
  });

  it("marks an owned notification as read", async () => {
    const notificationId = "019f4970-b34a-7035-ad98-dfea56b2974d";
    const readAt = new Date("2026-07-02T01:00:00.000Z");
    const query = queryReturning([{ id: notificationId, readAt }]);
    const service = serviceWith({
      update: jest.fn().mockReturnValue(query),
    });

    await expect(
      service.markNotificationRead({
        userId: "human-1",
        notificationId,
      }),
    ).resolves.toEqual({
      id: notificationId,
      readAt: readAt.toISOString(),
    });
    expect(query.set).toHaveBeenCalledWith({ readAt: expect.any(Date) });
    expect(query.returning).toHaveBeenCalledTimes(1);
  });

  it("treats malformed notification IDs as missing without querying Drizzle", async () => {
    const update = jest.fn();
    const service = serviceWith({ update });

    await expect(
      service.markNotificationRead({
        userId: "human-1",
        notificationId: "bad-id",
      }),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects malformed notification cursors without querying Drizzle", async () => {
    const select = jest.fn();
    const service = serviceWith({ select });
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
    expect(select).not.toHaveBeenCalled();
  });
});
