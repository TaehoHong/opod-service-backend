import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CharactersService } from "../characters/characters.service";
import { CreditsService } from "../credits/credits.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import { EventsService } from "../events/events.service";
import {
  MESSAGE_REPLY_PROVIDER,
  MessageReplyProvider,
} from "./message-reply.provider";

type Conversation = {
  id: string;
  userId: string;
  characterId: string;
};

type Message = {
  id: string;
  conversationId: string;
  senderType: "user" | "character";
  body: string;
  createdAt: string;
};

type PrismaMessage = Prisma.MessageGetPayload<Prisma.MessageDefaultArgs>;

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

@Injectable()
export class MessagesService {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
    private readonly eventsService: EventsService,
    @Inject(MESSAGE_REPLY_PROVIDER)
    private readonly replyProvider: MessageReplyProvider,
  ) {}

  async sendMessage(input: {
    userId: string;
    characterId: string;
    body: unknown;
  }): Promise<{ conversationId: string; messages: Message[] }> {
    const body = typeof input.body === "string" ? input.body.trim() : "";

    if (!body) {
      throw new BadRequestException("Message body is required");
    }

    await this.assertCharacter(input.characterId);

    // Reserve before any write so an insufficient balance leaves no trace.
    const reservation = await this.creditsService.reserveCredits({
      userId: input.userId,
      actionType: "chat_reply",
    });

    try {
      const conversation = await this.findOrCreateConversation(input);
      const humanMessage = await this.addMessage(conversation.id, "user", body);
      const history = await this.prisma.message.findMany({
        where: { conversationId: conversation.id },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const reply = await this.addMessage(
        conversation.id,
        "character",
        await this.replyProvider.createReply({
          userId: input.userId,
          characterId: input.characterId,
          conversationId: conversation.id,
          messages: history.map((message) => ({
            role: message.senderType === "user" ? "user" : "assistant",
            content: message.body,
          })),
          turnId: humanMessage.id,
        }),
      );
      await this.creditsService.captureReservation({
        reference: reservation.reference,
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
        conversationId: conversation.id,
        messages: [humanMessage, reply],
      };
    } catch (error) {
      await this.creditsService
        .releaseReservation({ reference: reservation.reference })
        .catch(() => undefined);
      // DM 응답 실패는 유저에게 에러로 돌아가고 끝이라 durable 로그를 남긴다
      // (service_logs). 로그 실패(동기 포함)가 원래 에러를 가려선 안 된다.
      try {
        await this.prisma.serviceLog.create({
          data: {
            source: "service-backend",
            level: "error",
            eventType: "MESSAGE_REPLY_FAILED",
            message: error instanceof Error ? error.message : String(error),
            contextJson: {
              userId: input.userId,
              characterId: input.characterId,
            },
          },
        });
      } catch {
        // durable 로그는 베스트에포트.
      }
      throw error;
    }
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
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    return pageFromRows(
      messages.map((message) => this.toMessage(message as PrismaMessage)),
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

  private async assertCharacter(characterId: string) {
    if (!(await this.charactersService.hasCharacter(characterId))) {
      throw new BadRequestException("Character not found");
    }
  }

  private async findOrCreateConversation(input: {
    userId: string;
    characterId: string;
  }): Promise<Conversation> {
    return this.prisma.messageConversation.upsert({
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

  private async addMessage(
    conversationId: string,
    senderType: Message["senderType"],
    body: string,
  ): Promise<Message> {
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderType,
        body,
      },
    });
    // 대화 목록 정렬 키. 유저 메시지든 캐릭터 답장이든 마지막 활동 시각이
    // 갱신돼야 하므로 전송 경로가 아니라 여기서 찍는다 — 나중에 선톡처럼
    // 다른 경로가 생겨도 자동으로 반영된다.
    await this.prisma.messageConversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt },
    });
    return this.toMessage(message as PrismaMessage);
  }

  private toMessage(message: PrismaMessage): Message {
    return {
      id: message.id,
      conversationId: message.conversationId,
      senderType: message.senderType,
      body: message.body,
      createdAt: message.createdAt.toISOString(),
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
