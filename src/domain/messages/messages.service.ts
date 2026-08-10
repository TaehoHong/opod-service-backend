import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CharactersService } from "../characters/characters.service";
import { CreditsService } from "../credits/credits.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import { isUuid } from "../database/uuid";
import { EventsService } from "../events/events.service";

type Conversation = {
  id: string;
  userId: string;
  characterId: string;
};

/**
 * 답변 작업의 공개 상태. 내부 `queued`/`running`을 하나의 `pending`으로 접는다 —
 * 앱은 아직 안 왔는지 아닌지만 알면 되고, 워커의 선점 여부는 내부 사정이다.
 */
export type ReplyStatus = "pending" | "completed" | "failed";

type Message = {
  id: string;
  conversationId: string;
  senderType: "user" | "character";
  body: string;
  createdAt: string;
  // 답변 작업에 속한 메시지에만 있다. 비동기 전환 이전 메시지는 작업이 없다.
  turnId?: string;
  replyStatus?: ReplyStatus;
};

const messageWithJob = {
  replyJob: { select: { turnId: true, status: true } },
} satisfies Prisma.MessageInclude;

type PrismaMessage = Prisma.MessageGetPayload<{
  include: typeof messageWithJob;
}>;

type ConversationSummary = {
  id: string;
  conversationId: string;
  character: {
    id: string;
    publicId: string;
    displayName: string;
    bio: string;
    interests: string[];
  };
  lastMessage?: Message;
  unreadCount: number;
};

type PrismaConversationSummary = {
  id: string;
  character: ConversationSummary["character"];
  messages: PrismaMessage[];
};

type ConversationReadReceipt = {
  conversationId: string;
  lastReadAt: string;
};

type SendMessageResult = {
  conversationId: string;
  messages: Message[];
};

type RetryResult = {
  turnId: string;
  replyStatus: ReplyStatus;
};

export function toReplyStatus(
  status: "queued" | "running" | "completed" | "failed",
): ReplyStatus {
  return status === "queued" || status === "running" ? "pending" : status;
}

@Injectable()
export class MessagesService {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly eventsService: EventsService,
  ) {}

  /**
   * 사용자 메시지와 답변 작업을 저장하고 즉시 반환한다. Agent 호출은 워커가 맡는다.
   *
   * 여기서 답변까지 기다리면 HTTP 요청 하나가 생성 시간 전체(분 단위)를 붙들고,
   * 그 사이 프로세스가 죽으면 예약만 남고 답변은 사라진다. 작업을 DB에 남기는
   * 이유가 그것이다.
   */
  async sendMessage(input: {
    userId: string;
    characterId: string;
    body: unknown;
  }): Promise<SendMessageResult> {
    const body = typeof input.body === "string" ? input.body.trim() : "";

    if (!body) {
      throw new BadRequestException("Message body is required");
    }

    await this.assertCharacter(input.characterId);

    // Reserve before any write so an insufficient balance leaves no trace.
    // 만료 없는 예약이다 — 대기·재시도가 5분 TTL보다 길어질 수 있고, 그러면
    // 답변 성공과 예약 만료가 경합한다. 수명은 작업이 관리한다.
    const reservation = await this.creditsService.reserveCredits({
      userId: input.userId,
      actionType: "chat_reply",
      expiresAt: null,
    });

    try {
      const saved = await this.prisma.$transaction(async (tx) => {
        const conversation = await this.findOrCreateConversation(tx, input);
        const message = await this.appendMessageWithClient(tx, {
          conversationId: conversation.id,
          senderType: "user",
          body,
        });
        const job = await tx.messageReplyJob.create({
          data: {
            conversationId: conversation.id,
            turnId: message.id,
            reservationReference: reservation.reference,
          },
        });
        const linked = await tx.message.update({
          where: { id: message.id },
          data: { replyJobId: job.id },
          include: messageWithJob,
        });
        return { conversationId: conversation.id, message: linked };
      });

      void this.eventsService
        .recordEvent({
          userId: input.userId,
          eventType: "message_character",
          targetType: "character",
          targetId: input.characterId,
        })
        .catch(() => undefined);

      return {
        conversationId: saved.conversationId,
        messages: [this.toMessage(saved.message)],
      };
    } catch (error) {
      await this.creditsService
        .releaseReservation({ reference: reservation.reference })
        .catch(() => undefined);
      await this.logFailure(error, {
        userId: input.userId,
        characterId: input.characterId,
      });
      throw error;
    }
  }

  /**
   * 최종 실패한 작업을 다시 큐에 넣는다. `readyAt`을 지금으로 다시 찍으므로
   * 대화에 대기 중인 작업이 있다면 그 뒤로 간다 — 실패한 턴이 새 대화 흐름을
   * 앞지르지 않게 하기 위해서다.
   */
  async retryReply(input: {
    userId: string;
    turnId: unknown;
  }): Promise<RetryResult> {
    const turnId = typeof input.turnId === "string" ? input.turnId.trim() : "";
    if (!turnId || !isUuid(turnId)) {
      throw new NotFoundException("Reply job not found");
    }

    const job = await this.prisma.messageReplyJob.findUnique({
      where: { turnId },
      include: { conversation: { select: { userId: true } } },
    });
    // 남의 대화는 존재 자체를 알리지 않는다.
    if (!job || job.conversation.userId !== input.userId) {
      throw new NotFoundException("Reply job not found");
    }
    if (job.status !== "failed") {
      throw new ConflictException("Reply job is not retryable");
    }

    const reservation = await this.creditsService.reserveCredits({
      userId: input.userId,
      actionType: "chat_reply",
      expiresAt: null,
    });

    // status 가드가 동시 재시도를 하나로 접는다. 진 쪽은 방금 잡은 예약을
    // 돌려놓는다 — 안 그러면 재시도 한 번에 두 번 차감된다.
    const requeued = await this.prisma.messageReplyJob.updateMany({
      where: { id: job.id, status: "failed" },
      data: {
        status: "queued",
        reservationReference: reservation.reference,
        readyAt: new Date(),
        attemptCount: 0,
        leaseExpiresAt: null,
        startedAt: null,
        deadlineAt: null,
        failedAt: null,
        failureReason: null,
      },
    });
    if (requeued.count === 0) {
      await this.creditsService
        .releaseReservation({ reference: reservation.reference })
        .catch(() => undefined);
      throw new ConflictException("Reply job is not retryable");
    }

    // 이전 시도의 예약은 실패로 닫힐 때 이미 해제됐다.
    return { turnId, replyStatus: "pending" };
  }

  async getMessagesPage(
    input: {
      userId: string;
      characterId: string;
    } & PageInput,
  ): Promise<Page<Message>> {
    const cursorId = decodeCursor(input.cursor);

    await this.assertCharacter(input.characterId);

    const conversation = await this.findConversation(input);

    if (!conversation) {
      return { items: [] };
    }

    if (
      cursorId &&
      !(await this.prisma.message.findFirst({
        where: { id: cursorId, conversationId: conversation.id },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit + 1,
      include: messageWithJob,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      messages.map((message) => this.toMessage(message)),
      input.limit,
    );
  }

  async listConversationsPage(
    input: { userId: string } & PageInput,
  ): Promise<Page<Omit<ConversationSummary, "id">>> {
    const cursorId = decodeCursor(input.cursor);

    const where = {
      userId: input.userId,
      character: { status: "active" as const },
    };
    if (
      cursorId &&
      !(await this.prisma.messageConversation.findFirst({
        where: { id: cursorId, ...where },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException("Invalid cursor");
    }

    const conversations = await this.prisma.messageConversation.findMany({
      where,
      // 대화가 시작된 시각이 아니라 마지막 활동 기준으로 정렬한다.
      orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      include: {
        character: {
          select: {
            id: true,
            publicId: true,
            displayName: true,
            bio: true,
            interests: true,
          },
        },
        messages: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: messageWithJob,
        },
      },
    });
    const unreadCounts = await this.unreadCountsFor(conversations);
    const page = pageFromRows(
      conversations.map((conversation) =>
        this.toConversationSummary(
          conversation as unknown as PrismaConversationSummary,
          unreadCounts.get(conversation.id) ?? 0,
        ),
      ),
      input.limit,
    );

    return {
      items: page.items.map((item) => ({
        conversationId: item.conversationId,
        character: item.character,
        ...(item.lastMessage ? { lastMessage: item.lastMessage } : {}),
        unreadCount: item.unreadCount,
      })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  // 읽음은 앱이 대화를 실제로 보여줬을 때 명시적으로 찍는다. 조회(GET)에
  // 부수효과를 두지 않고, 메시지 전송이 자동으로 읽음 처리하지도 않는다.
  async markConversationRead(input: {
    userId: string;
    characterId: string;
  }): Promise<ConversationReadReceipt> {
    await this.assertCharacter(input.characterId);

    const conversation = await this.findConversation(input);
    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    const updated = await this.prisma.messageConversation.update({
      where: { id: conversation.id },
      data: { lastReadAt: new Date() },
      select: { id: true, lastReadAt: true },
    });
    return {
      conversationId: updated.id,
      lastReadAt: updated.lastReadAt!.toISOString(),
    };
  }

  /**
   * 메시지를 추가하고 대화 목록 정렬 키를 갱신한다. 유저 메시지든 캐릭터 답장이든
   * 마지막 활동 시각이 갱신돼야 하므로 전송 경로가 아니라 여기에 둔다 — 워커의
   * 답변 저장도 같은 경로를 쓴다.
   */
  async appendMessageWithClient(
    client: Prisma.TransactionClient,
    input: {
      conversationId: string;
      senderType: Message["senderType"];
      body: string;
      replyJobId?: string;
    },
  ): Promise<PrismaMessage> {
    const message = await client.message.create({
      data: {
        conversationId: input.conversationId,
        senderType: input.senderType,
        body: input.body,
        ...(input.replyJobId ? { replyJobId: input.replyJobId } : {}),
      },
      include: messageWithJob,
    });
    await client.messageConversation.update({
      where: { id: input.conversationId },
      data: { lastMessageAt: message.createdAt },
    });
    return message;
  }

  /**
   * DM 실패는 유저에게 에러로 돌아가고 끝이라 durable 로그를 남긴다
   * (service_logs). 로그 실패가 원래 에러를 가려선 안 된다.
   */
  async logFailure(
    error: unknown,
    context: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.serviceLog.create({
        data: {
          source: "service-backend",
          level: "error",
          eventType: "MESSAGE_REPLY_FAILED",
          message: error instanceof Error ? error.message : String(error),
          contextJson: context as Prisma.InputJsonValue,
        },
      });
    } catch {
      // durable 로그는 베스트에포트.
    }
  }

  private async assertCharacter(characterId: string) {
    if (!(await this.charactersService.hasCharacter(characterId))) {
      throw new BadRequestException("Character not found");
    }
  }

  private async findOrCreateConversation(
    client: Prisma.TransactionClient,
    input: {
      userId: string;
      characterId: string;
    },
  ): Promise<Conversation> {
    return client.messageConversation.upsert({
      where: {
        userId_characterId: {
          userId: input.userId,
          characterId: input.characterId,
        },
      },
      update: {},
      create: {
        userId: input.userId,
        characterId: input.characterId,
      },
    });
  }

  private async findConversation(input: {
    userId: string;
    characterId: string;
  }): Promise<{ id: string } | null> {
    return this.prisma.messageConversation.findUnique({
      where: {
        userId_characterId: {
          userId: input.userId,
          characterId: input.characterId,
        },
      },
      select: { id: true },
    });
  }

  private toMessage(message: PrismaMessage): Message {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderType: message.senderType,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
      ...(message.replyJob
        ? {
            turnId: message.replyJob.turnId,
            replyStatus: toReplyStatus(message.replyJob.status),
          }
        : {}),
    };
  }

  private toConversationSummary(
    conversation: PrismaConversationSummary,
    unreadCount: number,
  ): ConversationSummary {
    const [lastMessage] = conversation.messages;
    return {
      id: conversation.id,
      conversationId: conversation.id,
      character: conversation.character,
      ...(lastMessage ? { lastMessage: this.toMessage(lastMessage) } : {}),
      unreadCount,
    };
  }

  // 대화별 미읽음 수를 한 번의 groupBy로 계산한다. 대화마다 기준 시각이 달라
  // OR 창을 쓴다. 유저 자신이 보낸 메시지는 세지 않는다 — 그러면 대화를 시작한
  // 순간부터 배지가 붙는다.
  private async unreadCountsFor(
    conversations: { id: string; lastReadAt: Date | null }[],
  ): Promise<Map<string, number>> {
    if (conversations.length === 0) {
      return new Map();
    }
    const grouped = await this.prisma.message.groupBy({
      by: ["conversationId"],
      where: {
        senderType: "character",
        OR: conversations.map((conversation) => ({
          conversationId: conversation.id,
          // lastReadAt이 null이면 한 번도 읽지 않은 대화라 전부 미읽음이다.
          ...(conversation.lastReadAt
            ? { createdAt: { gt: conversation.lastReadAt } }
            : {}),
        })),
      },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.conversationId, row._count._all]));
  }
}
