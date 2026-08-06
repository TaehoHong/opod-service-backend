import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import { isUuid } from "../database/uuid";
import { NotificationTargetType, NotificationType } from "./notification-types";

type NotificationClient = Prisma.TransactionClient | PrismaService;

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

type PrismaNotification =
  Prisma.NotificationGetPayload<Prisma.NotificationDefaultArgs>;

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // 알림 생성 정본. 알림은 그것을 유발한 쓰기와 같은 트랜잭션에서 만들어야
  // 하므로(부분 실패 시 알림만 남는 것을 막는다) 호출자의 client를 받는다.
  // 중복 방지는 호출자 몫이다 — 트리거 지점의 상태 전이 가드가 이미 한 번만
  // 통과하도록 보장한다.
  async createNotificationWithClient(
    client: NotificationClient,
    input: {
      userId: string;
      type: NotificationType;
      title: string;
      body?: string;
      targetType?: NotificationTargetType;
      targetId?: string;
    },
  ): Promise<Notification> {
    const notification = await client.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        ...(input.body === undefined ? {} : { body: input.body }),
        ...(input.targetType === undefined
          ? {}
          : { targetType: input.targetType }),
        ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
      },
    });
    return this.toNotification(notification as PrismaNotification);
  }

  async listNotificationsPage(
    input: {
      userId: string;
      unreadOnly?: boolean;
    } & PageInput,
  ): Promise<Page<Notification>> {
    const cursorId = decodeCursor(input.cursor);
    if (cursorId && !isUuid(cursorId)) {
      throw new BadRequestException("Invalid cursor");
    }
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
    if (!isUuid(input.notificationId)) {
      return null;
    }
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
