import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, asc, count, desc, eq, gt, lt, or } from "drizzle-orm";
import { CharactersService } from "../characters/characters.service";
import { CreditsService } from "../credits/credits.service";
import {
  DatabaseService,
  type DatabaseClient,
} from "../database/database.service";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import {
  characters,
  messageConversations,
  messageReplyJobs,
  messages,
  serviceLogs,
} from "../database/schema";
import { isUuid } from "../database/uuid";
import { EventsService } from "../events/events.service";

type MessageClient = Pick<
  DatabaseClient,
  "select" | "insert" | "update" | "delete" | "execute"
>;
type Conversation = typeof messageConversations.$inferSelect;

export type ReplyStatus = "pending" | "completed" | "failed";

type Message = {
  id: string;
  conversationId: string;
  senderType: "user" | "character";
  body: string;
  createdAt: string;
  turnId?: string;
  replyStatus?: ReplyStatus;
};

type MessageRow = typeof messages.$inferSelect & {
  replyJob: {
    turnId: string;
    status: "queued" | "running" | "completed" | "failed";
  } | null;
};

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

type ConversationReadReceipt = {
  conversationId: string;
  lastReadAt: string;
};

type SendMessageResult = { conversationId: string; messages: Message[] };
type RetryResult = { turnId: string; replyStatus: ReplyStatus };

const messageSelection = {
  id: messages.id,
  conversationId: messages.conversationId,
  senderType: messages.senderType,
  body: messages.body,
  createdAt: messages.createdAt,
  replyJobId: messages.replyJobId,
  replyJob: {
    turnId: messageReplyJobs.turnId,
    status: messageReplyJobs.status,
  },
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
    private readonly database: DatabaseService,
    private readonly creditsService: CreditsService,
    private readonly eventsService: EventsService,
  ) {}

  async sendMessage(input: {
    userId: string;
    characterId: string;
    body: unknown;
  }): Promise<SendMessageResult> {
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!body) throw new BadRequestException("Message body is required");
    await this.assertCharacter(input.characterId);

    const reservation = await this.creditsService.reserveCredits({
      userId: input.userId,
      actionType: "chat_reply",
      expiresAt: null,
    });
    try {
      const saved = await this.database.client.transaction(async (tx) => {
        const conversation = await this.findOrCreateConversation(tx, input);
        const message = await this.appendMessageWithClient(tx, {
          conversationId: conversation.id,
          senderType: "user",
          body,
        });
        const [job] = await tx
          .insert(messageReplyJobs)
          .values({
            conversationId: conversation.id,
            turnId: message.id,
            reservationReference: reservation.reference,
          })
          .returning();
        await tx
          .update(messages)
          .set({ replyJobId: job.id })
          .where(eq(messages.id, message.id));
        const linked = await this.findMessage(tx, message.id);
        if (!linked) throw new Error("Created message was not found");
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

  async retryReply(input: {
    userId: string;
    turnId: unknown;
  }): Promise<RetryResult> {
    const turnId = typeof input.turnId === "string" ? input.turnId.trim() : "";
    if (!turnId || !isUuid(turnId)) {
      throw new NotFoundException("Reply job not found");
    }
    const [job] = await this.database.client
      .select({
        id: messageReplyJobs.id,
        status: messageReplyJobs.status,
        conversationUserId: messageConversations.userId,
      })
      .from(messageReplyJobs)
      .innerJoin(
        messageConversations,
        eq(messageReplyJobs.conversationId, messageConversations.id),
      )
      .where(eq(messageReplyJobs.turnId, turnId))
      .limit(1);
    if (!job || job.conversationUserId !== input.userId) {
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
    const requeued = await this.database.client
      .update(messageReplyJobs)
      .set({
        status: "queued",
        reservationReference: reservation.reference,
        readyAt: new Date(),
        attemptCount: 0,
        leaseExpiresAt: null,
        startedAt: null,
        deadlineAt: null,
        failedAt: null,
        failureReason: null,
      })
      .where(
        and(
          eq(messageReplyJobs.id, job.id),
          eq(messageReplyJobs.status, "failed"),
        ),
      )
      .returning({ id: messageReplyJobs.id });
    if (!requeued.length) {
      await this.creditsService
        .releaseReservation({ reference: reservation.reference })
        .catch(() => undefined);
      throw new ConflictException("Reply job is not retryable");
    }
    return { turnId, replyStatus: "pending" };
  }

  async getMessagesPage(
    input: { userId: string; characterId: string } & PageInput,
  ): Promise<Page<Message>> {
    const cursorId = decodeCursor(input.cursor);
    await this.assertCharacter(input.characterId);
    const conversation = await this.findConversation(input);
    if (!conversation) return { items: [] };

    let cursor: { id: string; createdAt: Date } | undefined;
    if (cursorId) {
      [cursor] = await this.database.client
        .select({ id: messages.id, createdAt: messages.createdAt })
        .from(messages)
        .where(
          and(
            eq(messages.id, cursorId),
            eq(messages.conversationId, conversation.id),
          ),
        )
        .limit(1);
      if (!cursor) throw new BadRequestException("Invalid cursor");
    }
    const rows = await this.database.client
      .select(messageSelection)
      .from(messages)
      .leftJoin(messageReplyJobs, eq(messages.replyJobId, messageReplyJobs.id))
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          cursor
            ? or(
                gt(messages.createdAt, cursor.createdAt),
                and(
                  eq(messages.createdAt, cursor.createdAt),
                  gt(messages.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id))
      .limit(input.limit + 1);
    return pageFromRows(
      rows.map((message) => this.toMessage(message)),
      input.limit,
    );
  }

  async listConversationsPage(
    input: { userId: string } & PageInput,
  ): Promise<Page<Omit<ConversationSummary, "id">>> {
    const cursorId = decodeCursor(input.cursor);
    let cursor: { id: string; lastMessageAt: Date } | undefined;
    if (cursorId) {
      [cursor] = await this.database.client
        .select({
          id: messageConversations.id,
          lastMessageAt: messageConversations.lastMessageAt,
        })
        .from(messageConversations)
        .innerJoin(
          characters,
          eq(messageConversations.characterId, characters.id),
        )
        .where(
          and(
            eq(messageConversations.id, cursorId),
            eq(messageConversations.userId, input.userId),
            eq(characters.status, "active"),
          ),
        )
        .limit(1);
      if (!cursor) throw new BadRequestException("Invalid cursor");
    }
    const conversations = await this.database.client
      .select({
        id: messageConversations.id,
        lastReadAt: messageConversations.lastReadAt,
        lastMessageAt: messageConversations.lastMessageAt,
        character: {
          id: characters.id,
          publicId: characters.publicId,
          displayName: characters.displayName,
          bio: characters.bio,
          interests: characters.interests,
        },
      })
      .from(messageConversations)
      .innerJoin(
        characters,
        eq(messageConversations.characterId, characters.id),
      )
      .where(
        and(
          eq(messageConversations.userId, input.userId),
          eq(characters.status, "active"),
          cursor
            ? or(
                lt(messageConversations.lastMessageAt, cursor.lastMessageAt),
                and(
                  eq(messageConversations.lastMessageAt, cursor.lastMessageAt),
                  lt(messageConversations.id, cursor.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(
        desc(messageConversations.lastMessageAt),
        desc(messageConversations.id),
      )
      .limit(input.limit + 1);
    const [unreadCounts, lastMessages] = await Promise.all([
      this.unreadCountsFor(conversations),
      Promise.all(
        conversations.map(async (conversation) => {
          const [message] = await this.database.client
            .select(messageSelection)
            .from(messages)
            .leftJoin(
              messageReplyJobs,
              eq(messages.replyJobId, messageReplyJobs.id),
            )
            .where(eq(messages.conversationId, conversation.id))
            .orderBy(desc(messages.createdAt), desc(messages.id))
            .limit(1);
          return [conversation.id, message] as const;
        }),
      ),
    ]);
    const lastByConversation = new Map(lastMessages);
    const page = pageFromRows(
      conversations.map((conversation) => ({
        id: conversation.id,
        conversationId: conversation.id,
        character: {
          ...conversation.character,
          interests: conversation.character.interests ?? [],
        },
        ...(lastByConversation.get(conversation.id)
          ? {
              lastMessage: this.toMessage(
                lastByConversation.get(conversation.id)!,
              ),
            }
          : {}),
        unreadCount: unreadCounts.get(conversation.id) ?? 0,
      })),
      input.limit,
    );
    return {
      items: page.items.map(
        ({ conversationId, character, lastMessage, unreadCount }) => ({
          conversationId,
          character,
          ...(lastMessage ? { lastMessage } : {}),
          unreadCount,
        }),
      ),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  async markConversationRead(input: {
    userId: string;
    characterId: string;
  }): Promise<ConversationReadReceipt> {
    await this.assertCharacter(input.characterId);
    const conversation = await this.findConversation(input);
    if (!conversation) throw new NotFoundException("Conversation not found");
    const [updated] = await this.database.client
      .update(messageConversations)
      .set({ lastReadAt: new Date() })
      .where(eq(messageConversations.id, conversation.id))
      .returning({
        id: messageConversations.id,
        lastReadAt: messageConversations.lastReadAt,
      });
    return {
      conversationId: updated.id,
      lastReadAt: updated.lastReadAt!.toISOString(),
    };
  }

  async appendMessageWithClient(
    client: MessageClient,
    input: {
      conversationId: string;
      senderType: Message["senderType"];
      body: string;
      replyJobId?: string;
    },
  ): Promise<MessageRow> {
    const [created] = await client
      .insert(messages)
      .values({
        conversationId: input.conversationId,
        senderType: input.senderType,
        body: input.body,
        replyJobId: input.replyJobId,
      })
      .returning();
    await client
      .update(messageConversations)
      .set({ lastMessageAt: created.createdAt })
      .where(eq(messageConversations.id, input.conversationId));
    return {
      ...created,
      replyJob: input.replyJobId
        ? await this.findReplyJob(client, input.replyJobId)
        : null,
    };
  }

  async logFailure(
    error: unknown,
    context: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.database.client.insert(serviceLogs).values({
        source: "service-backend",
        level: "error",
        eventType: "MESSAGE_REPLY_FAILED",
        message: error instanceof Error ? error.message : String(error),
        contextJson: context,
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
    client: MessageClient,
    input: { userId: string; characterId: string },
  ): Promise<Conversation> {
    const [created] = await client
      .insert(messageConversations)
      .values(input)
      .onConflictDoNothing({
        target: [messageConversations.userId, messageConversations.characterId],
      })
      .returning();
    if (created) return created;
    const [existing] = await client
      .select()
      .from(messageConversations)
      .where(
        and(
          eq(messageConversations.userId, input.userId),
          eq(messageConversations.characterId, input.characterId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Conversation was not created");
    return existing;
  }

  private async findConversation(input: {
    userId: string;
    characterId: string;
  }): Promise<{ id: string } | null> {
    const [conversation] = await this.database.client
      .select({ id: messageConversations.id })
      .from(messageConversations)
      .where(
        and(
          eq(messageConversations.userId, input.userId),
          eq(messageConversations.characterId, input.characterId),
        ),
      )
      .limit(1);
    return conversation ?? null;
  }

  private async findMessage(client: MessageClient, id: string) {
    const [message] = await client
      .select(messageSelection)
      .from(messages)
      .leftJoin(messageReplyJobs, eq(messages.replyJobId, messageReplyJobs.id))
      .where(eq(messages.id, id))
      .limit(1);
    return message;
  }

  private async findReplyJob(client: MessageClient, id: string) {
    const [job] = await client
      .select({
        turnId: messageReplyJobs.turnId,
        status: messageReplyJobs.status,
      })
      .from(messageReplyJobs)
      .where(eq(messageReplyJobs.id, id))
      .limit(1);
    return job ?? null;
  }

  private toMessage(message: MessageRow): Message {
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

  private async unreadCountsFor(
    conversations: { id: string; lastReadAt: Date | null }[],
  ): Promise<Map<string, number>> {
    if (!conversations.length) return new Map();
    const windows = conversations.map((conversation) =>
      and(
        eq(messages.conversationId, conversation.id),
        conversation.lastReadAt
          ? gt(messages.createdAt, conversation.lastReadAt)
          : undefined,
      ),
    );
    const grouped = await this.database.client
      .select({ conversationId: messages.conversationId, value: count() })
      .from(messages)
      .where(and(eq(messages.senderType, "character"), or(...windows)))
      .groupBy(messages.conversationId);
    return new Map(grouped.map((row) => [row.conversationId, row.value]));
  }
}
