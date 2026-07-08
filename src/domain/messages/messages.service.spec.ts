import { EventsService } from "../events/events.service";
import { InsufficientCreditsException } from "../credits/insufficient-credits.exception";
import { MessagesService } from "./messages.service";

type MessagesServiceCtor = new (
  usersService: unknown,
  charactersService: unknown,
  prisma: unknown,
  creditsService: unknown,
  eventsService?: unknown,
  replyProvider?: unknown,
) => MessagesService;

function createCreditsStub() {
  return {
    reserveCredits: jest.fn().mockResolvedValue({
      id: "reservation-1",
      reference: "chat_reply:test",
      status: "reserved",
      amount: 2,
    }),
    captureReservation: jest.fn().mockResolvedValue({
      id: "reservation-1",
      reference: "chat_reply:test",
      status: "captured",
      amount: 2,
    }),
    releaseReservation: jest.fn().mockResolvedValue({
      id: "reservation-1",
      reference: "chat_reply:test",
      status: "released",
      amount: 2,
    }),
  };
}

describe("MessagesService", () => {
  it("stores the reply and captures the reserved credits", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: "message-human",
        conversationId: "conversation-1",
        senderType: "user",
        body: "hello",
        createdAt,
      })
      .mockResolvedValueOnce({
        id: "message-ai",
        conversationId: "conversation-1",
        senderType: "character",
        body: "provider says hi",
        createdAt,
      });
    const replyProvider = {
      createReply: jest.fn().mockResolvedValue("provider says hi"),
    };
    const credits = createCreditsStub();
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "ai-1",
          }),
        },
        message: { create },
      },
      credits,
      undefined,
      replyProvider,
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: " hello ",
      }),
    ).resolves.toMatchObject({
      messages: [
        { senderType: "user", body: "hello" },
        { senderType: "character", body: "provider says hi" },
      ],
    });
    expect(replyProvider.createReply).toHaveBeenCalledWith({
      characterId: "ai-1",
      userId: "human-1",
      messageBody: "hello",
    });
    expect(credits.reserveCredits).toHaveBeenCalledWith({
      userId: "human-1",
      actionType: "chat_reply",
    });
    expect(credits.captureReservation).toHaveBeenCalledWith({
      reference: "chat_reply:test",
    });
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  it("releases the reservation when the reply provider fails", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest.fn().mockResolvedValueOnce({
      id: "message-human",
      conversationId: "conversation-1",
      senderType: "user",
      body: "hello",
      createdAt,
    });
    const credits = createCreditsStub();
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "ai-1",
          }),
        },
        message: { create },
      },
      credits,
      undefined,
      { createReply: jest.fn().mockRejectedValue(new Error("provider down")) },
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "hello",
      }),
    ).rejects.toThrow("provider down");
    expect(create).toHaveBeenCalledTimes(1);
    expect(credits.captureReservation).not.toHaveBeenCalled();
    expect(credits.releaseReservation).toHaveBeenCalledWith({
      reference: "chat_reply:test",
    });
  });

  it("blocks the message before any write when credits are insufficient", async () => {
    const upsert = jest.fn();
    const create = jest.fn();
    const credits = createCreditsStub();
    credits.reserveCredits.mockRejectedValue(
      new InsufficientCreditsException(),
    );
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      { messageConversation: { upsert }, message: { create } },
      credits,
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "hello",
      }),
    ).rejects.toThrow(InsufficientCreditsException);
    expect(upsert).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  it("creates conversations and messages through Prisma", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const upsert = jest.fn().mockResolvedValue({
      id: "conversation-1",
      userId: "human-1",
      characterId: "ai-1",
    });
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: "message-human",
        conversationId: "conversation-1",
        senderType: "user",
        body: "hello",
        createdAt,
      })
      .mockResolvedValueOnce({
        id: "message-ai",
        conversationId: "conversation-1",
        senderType: "character",
        body: "AI reply to: hello",
        createdAt,
      });
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      { messageConversation: { upsert }, message: { create } },
      createCreditsStub(),
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: " hello ",
      }),
    ).resolves.toEqual({
      conversationId: "conversation-1",
      messages: [
        {
          id: "message-human",
          conversationId: "conversation-1",
          senderType: "user",
          body: "hello",
          createdAt: createdAt.toISOString(),
        },
        {
          id: "message-ai",
          conversationId: "conversation-1",
          senderType: "character",
          body: "AI reply to: hello",
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_characterId: {
          userId: "human-1",
          characterId: "ai-1",
        },
      },
      update: {},
      create: {
        userId: "human-1",
        characterId: "ai-1",
      },
    });
    expect(create).toHaveBeenNthCalledWith(1, {
      data: {
        conversationId: "conversation-1",
        senderType: "user",
        body: "hello",
      },
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: {
        conversationId: "conversation-1",
        senderType: "character",
        body: "AI reply to: hello",
      },
    });
  });

  it("reads messages through Prisma", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({ id: "conversation-1" });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "message-human",
        conversationId: "conversation-1",
        senderType: "user",
        body: "hello",
        createdAt,
      },
    ]);
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: { findUnique },
        message: { findMany },
      },
      createCreditsStub(),
    );

    await expect(
      service.getMessages({
        userId: "human-1",
        characterId: "ai-1",
      }),
    ).resolves.toEqual([
      {
        id: "message-human",
        conversationId: "conversation-1",
        senderType: "user",
        body: "hello",
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_characterId: {
          userId: "human-1",
          characterId: "ai-1",
        },
      },
      select: { id: true },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { conversationId: "conversation-1" },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns a cursor page of messages", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({ id: "conversation-1" });
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "message-human",
        conversationId: "conversation-1",
        senderType: "user",
        body: "hello",
        createdAt,
      },
      {
        id: "message-ai",
        conversationId: "conversation-1",
        senderType: "character",
        body: "reply",
        createdAt,
      },
    ]);
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: { findUnique },
        message: { findMany },
      },
      createCreditsStub(),
    );

    const page = await service.getMessagesPage({
      userId: "human-1",
      characterId: "ai-1",
      limit: 1,
    });

    expect(page.items.map((message: { id: string }) => message.id)).toEqual([
      "message-human",
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(findMany).toHaveBeenCalledWith({
      where: { conversationId: "conversation-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 2,
    });
  });

  it("returns a cursor page of conversations", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "conversation-2",
        userId: "human-1",
        characterId: "ai-2",
        createdAt,
        character: {
          id: "ai-2",
          publicId: "nari",
          displayName: "Nari",
          bio: "calm",
          interests: ["books"],
        },
        messages: [
          {
            id: "message-2",
            conversationId: "conversation-2",
            senderType: "character",
            body: "reply",
            createdAt,
          },
        ],
      },
      {
        id: "conversation-1",
        userId: "human-1",
        characterId: "ai-1",
        createdAt,
        character: {
          id: "ai-1",
          publicId: "arin",
          displayName: "Arin",
          bio: "playful",
          interests: ["art"],
        },
        messages: [],
      },
    ]);
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn() },
      {
        messageConversation: { findMany },
      },
      createCreditsStub(),
    );

    await expect(
      service.listConversationsPage({
        userId: "human-1",
        limit: 1,
      }),
    ).resolves.toEqual({
      items: [
        {
          conversationId: "conversation-2",
          character: {
            id: "ai-2",
            publicId: "nari",
            displayName: "Nari",
            bio: "calm",
            interests: ["books"],
          },
          lastMessage: {
            id: "message-2",
            conversationId: "conversation-2",
            senderType: "character",
            body: "reply",
            createdAt: createdAt.toISOString(),
          },
          unreadCount: 0,
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: "human-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
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
  });

  it("rejects empty human messages", async () => {
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn() },
      { hasCharacter: jest.fn() },
      {},
      createCreditsStub(),
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "   ",
      }),
    ).rejects.toThrow("Message body is required");
  });

  it("rejects unknown users", async () => {
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(false) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {},
      createCreditsStub(),
    );

    await expect(
      service.sendMessage({
        userId: "missing-human",
        characterId: "character-1",
        body: "hello",
      }),
    ).rejects.toThrow("User not found");
  });

  it("records a message event when a user messages a character", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const eventsService = {
      recordEvent: jest.fn(),
    } as unknown as EventsService;
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "character-1",
          }),
        },
        message: {
          create: jest
            .fn()
            .mockResolvedValueOnce({
              id: "message-human",
              conversationId: "conversation-1",
              senderType: "user",
              body: "hello",
              createdAt,
            })
            .mockResolvedValueOnce({
              id: "message-ai",
              conversationId: "conversation-1",
              senderType: "character",
              body: "AI reply to: hello",
              createdAt,
            }),
        },
      },
      createCreditsStub(),
      eventsService,
    );

    await service.sendMessage({
      userId: "human-1",
      characterId: "character-1",
      body: "hello",
    });

    expect(eventsService.recordEvent).toHaveBeenCalledWith({
      userId: "human-1",
      eventType: "message_character",
      targetType: "character",
      targetId: "character-1",
    });
  });
});
