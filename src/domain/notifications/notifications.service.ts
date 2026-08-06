import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import { isUuid } from "../database/uuid";
import {
  FOLLOW_NOTIFICATION_SYNC_LIMIT,
  NOTIFICATION_TYPES,
  NotificationTargetType,
  NotificationType,
} from "./notification-types";

type NotificationClient = Prisma.TransactionClient | PrismaService;

export type FollowNotificationSyncResult = {
  created: number;
  // 상한에 걸려 버려진 분량이 있었는지. 버린 개수를 세려면 추가 질의가 필요해
  // 틀린 숫자 대신 사실만 보고한다.
  truncated: boolean;
};

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

  // 팔로우한 캐릭터의 새 게시글·스토리를 알림 행으로 물질화한다.
  //
  // 게시는 opod-admin이 하므로 이 리포에서 write-time 팬아웃을 걸 수 없고,
  // 서버 푸시 발송 경로도 없어서(알림은 유저가 조회할 때만 보인다) 즉시
  // 팬아웃의 이점이 현재 존재하지 않는다. 그래서 앱이 이 경로를 부를 때
  // 만든다 — 비활성 유저의 팬아웃 비용이 0이고, 실제 행이라 읽음 처리와
  // 커서 페이지네이션이 그대로 동작한다.
  //
  // 잔여 리스크: READ COMMITTED에서 이 트랜잭션의 조회 직후 커밋되는
  // `createdAt <= syncedAt` 게시글은 워터마크가 이미 앞서 있어 누락된다.
  // 알림 1건을 놓치는 정도라 직렬화 수준을 올리지 않는다.
  async syncFollowNotifications(input: {
    userId: string;
  }): Promise<FollowNotificationSyncResult> {
    return this.prisma.$transaction(async (tx) => {
      // 같은 유저의 동시 sync가 같은 게시글로 알림을 두 번 만들지 않게
      // 직렬화한다. 워터마크 갱신까지 한 트랜잭션 안에서 끝난다.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`notifications:${input.userId}`}, 0))`;

      const follows = await tx.userCharacterFollow.findMany({
        where: { userId: input.userId, character: { status: "active" } },
        select: {
          characterId: true,
          notifiedUpToAt: true,
          character: { select: { displayName: true } },
        },
      });
      if (follows.length === 0) {
        return { created: 0, truncated: false };
      }

      const syncedAt = new Date();
      const windows = follows.map((follow) => ({
        characterId: follow.characterId,
        createdAt: { gt: follow.notifiedUpToAt, lte: syncedAt },
      }));
      const displayNames = new Map(
        follows.map((follow) => [
          follow.characterId,
          follow.character.displayName,
        ]),
      );
      // 상한 + 1을 읽어 잘린 분량이 있는지 판단한다.
      const take = FOLLOW_NOTIFICATION_SYNC_LIMIT + 1;
      const [posts, stories] = await Promise.all([
        tx.post.findMany({
          where: { OR: windows },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          select: { id: true, characterId: true, createdAt: true },
        }),
        tx.story.findMany({
          // 만료된 스토리는 열 수 없으므로 알리지 않는다.
          where: { AND: [{ OR: windows }, { expiresAt: { gt: syncedAt } }] },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take,
          select: { id: true, characterId: true, createdAt: true },
        }),
      ]);

      const candidates = [
        ...posts.map((post) => ({
          createdAt: post.createdAt,
          userId: input.userId,
          type: NOTIFICATION_TYPES.characterNewPost as string,
          title: `${displayNames.get(post.characterId) ?? "캐릭터"}님의 새 게시글`,
          targetType: "post",
          targetId: post.id,
        })),
        ...stories.map((story) => ({
          createdAt: story.createdAt,
          userId: input.userId,
          type: NOTIFICATION_TYPES.characterNewStory as string,
          title: `${displayNames.get(story.characterId) ?? "캐릭터"}님의 새 스토리`,
          targetType: "story",
          targetId: story.id,
        })),
      ].sort(
        (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
      );

      const truncated = candidates.length > FOLLOW_NOTIFICATION_SYNC_LIMIT;
      const selected = candidates.slice(0, FOLLOW_NOTIFICATION_SYNC_LIMIT);
      if (selected.length > 0) {
        await tx.notification.createMany({
          // createdAt은 정렬용이라 행에 싣지 않는다 — DB 기본값을 쓴다.
          data: selected.map((candidate) => ({
            userId: candidate.userId,
            type: candidate.type,
            title: candidate.title,
            targetType: candidate.targetType,
            targetId: candidate.targetId,
          })),
        });
      }
      // 잘렸어도 워터마크는 전진시킨다. 그러지 않으면 밀린 분량이 매 sync마다
      // 다시 잡혀 같은 자리에서 계속 맴돈다.
      await tx.userCharacterFollow.updateMany({
        where: {
          userId: input.userId,
          characterId: { in: follows.map((follow) => follow.characterId) },
        },
        data: { notifiedUpToAt: syncedAt },
      });

      return { created: selected.length, truncated };
    });
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
