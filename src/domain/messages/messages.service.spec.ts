import { EventsService } from "../events/events.service";
import { MessagesService } from "./messages.service";

describe("MessagesService", () => {
  it("stores the reply returned by the message reply provider", async () => {
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
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService: unknown,
        replyProvider: unknown,
      ) => MessagesService
    )(
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
    expect(create).toHaveBeenNthCalledWith(2, {
      data: {
        conversationId: "conversation-1",
        senderType: "character",
        body: "provider says hi",
      },
    });
  });

  it("does not store an AI reply when the reply provider fails", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest.fn().mockResolvedValueOnce({
      id: "message-human",
      conversationId: "conversation-1",
      senderType: "user",
      body: "hello",
      createdAt,
    });
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService: unknown,
        replyProvider: unknown,
      ) => MessagesService
    )(
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
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService?: unknown,
      ) => MessagesService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      { messageConversation: { upsert }, message: { create } },
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
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService?: unknown,
      ) => MessagesService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: { findUnique },
        message: { findMany },
      },
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
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService?: unknown,
      ) => MessagesService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: { findUnique },
        message: { findMany },
      },
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
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService?: unknown,
      ) => MessagesService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn() },
      {
        messageConversation: { findMany },
      },
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
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
      ) => MessagesService
    )({ hasUser: jest.fn() }, { hasCharacter: jest.fn() }, {});

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "   ",
      }),
    ).rejects.toThrow("Message body is required");
  });

  it("rejects unknown users", async () => {
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
      ) => MessagesService
    )(
      { hasUser: jest.fn().mockResolvedValue(false) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {},
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
    const service = new (
      MessagesService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService: unknown,
      ) => MessagesService
    )(
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
