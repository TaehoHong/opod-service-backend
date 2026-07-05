import { BadRequestException, Injectable } from "@nestjs/common";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";

export type Notification = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  targetType: string | null;
  targetId: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationReadReceipt = {
  id: string;
  readAt: string;
};

type PrismaNotification = Omit<Notification, "readAt" | "createdAt"> & {
  readAt: Date | null;
  createdAt: Date;
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listNotificationsPage(
    input: {
      userId: string;
      unreadOnly?: boolean;
    } & PageInput,
  ): Promise<Page<Notification>> {
    const cursorId = decodeCursor(input.cursor);
    const where = {
      userId: input.userId,
      ...(input.unreadOnly ? { readAt: null } : {}),
    };

    if (
      cursorId &&
      !(await this.prisma.notification.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      notifications.map((notification) =>
        this.toNotification(notification as PrismaNotification),
      ),
      input.limit,
    );
  }

  async markNotificationRead(input: {
    userId: string;
    notificationId: string;
  }): Promise<NotificationReadReceipt | null> {
    if (
      !(await this.prisma.notification.findFirst({
        where: { id: input.notificationId, userId: input.userId },
        select: { id: true },
      }))
    ) {
      return null;
    }

    const notification = await this.prisma.notification.update({
      where: { id: input.notificationId },
      data: { readAt: new Date() },
      select: { id: true, readAt: true },
    });
    return {
      id: notification.id,
      readAt: notification.readAt!.toISOString(),
    };
  }

  private toNotification(notification: PrismaNotification): Notification {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      targetType: notification.targetType,
      targetId: notification.targetId,
      readAt: notification.readAt?.toISOString() ?? null,
      createdAt: notification.createdAt.toISOString(),
    };
  }
}
