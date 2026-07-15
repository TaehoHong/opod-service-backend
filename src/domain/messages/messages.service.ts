import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CharactersService } from "../characters/characters.service";
import { CreditsService } from "../credits/credits.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { PrismaService } from "../database/prisma.service";
import { EventsService } from "../events/events.service";
import { UsersService } from "../users/users.service";
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
  unreadCount: 0;
};

type PrismaConversationSummary = {
  id: string;
  character: ConversationSummary["character"];
  messages: PrismaMessage[];
};

@Injectable()
export class MessagesService {
  constructor(
    private readonly usersService: UsersService,
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

    await this.assertUserAndCharacter(input);

    // Reserve before any write so an insufficient balance leaves no trace.
    const reservation = await this.creditsService.reserveCredits({
      userId: input.userId,
      actionType: "chat_reply",
    });

    try {
      const conversation = await this.findOrCreateConversation(input);
      const humanMessage = await this.addMessage(conversation.id, "user", body);
      const reply = await this.addMessage(
        conversation.id,
        "character",
        await this.createReply({
          userId: input.userId,
          characterId: input.characterId,
          messageBody: body,
        }),
      );
      await this.creditsService.captureReservation({
        reference: reservation.reference,
      });
      await this.recordMessageEvent(input).catch(() => undefined);

      return {
        conversationId: conversation.id,
        messages: [humanMessage, reply],
      };
    } catch (error) {
      await this.creditsService
        .releaseReservation({ reference: reservation.reference })
        .catch(() => undefined);
      throw error;
    }
  }

  async getMessages(input: {
    userId: string;
    characterId: string;
  }): Promise<Message[]> {
    await this.assertUserAndCharacter(input);

    const conversation = await this.findConversation(input);

    if (!conversation) {
      return [];
    }

    const messages = await this.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    return messages.map((message) => this.toMessage(message as PrismaMessage));
  }

  async getMessagesPage(
    input: {
      userId: string;
      characterId: string;
    } & PageInput,
  ): Promise<Page<Message>> {
    const cursorId = decodeCursor(input.cursor);

    await this.assertUserAndCharacter(input);

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

    if (!(await this.usersService.hasUser(input.userId))) {
      throw new BadRequestException("User not found");
    }

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
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
    const page = pageFromRows(
      conversations.map((conversation) =>
        this.toConversationSummary(
          conversation as unknown as PrismaConversationSummary,
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

  private async assertUserAndCharacter(input: {
    userId: string;
    characterId: string;
  }) {
    if (!(await this.usersService.hasUser(input.userId))) {
      throw new BadRequestException("User not found");
    }
    if (!(await this.charactersService.hasCharacter(input.characterId))) {
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
  ): ConversationSummary {
    const [lastMessage] = conversation.messages;
    return {
      id: conversation.id,
      conversationId: conversation.id,
      character: conversation.character,
      ...(lastMessage ? { lastMessage: this.toMessage(lastMessage) } : {}),
      // ponytail: no read-receipt table yet; replace with real unread count when reads exist.
      unreadCount: 0,
    };
  }

  private createReply(input: {
    userId: string;
    characterId: string;
    messageBody: string;
  }) {
    return this.replyProvider.createReply(input);
  }

  private async recordMessageEvent(input: {
    userId: string;
    characterId: string;
  }) {
    await this.eventsService.recordEvent({
      userId: input.userId,
      eventType: "message_character",
      targetType: "character",
      targetId: input.characterId,
    });
  }
}
