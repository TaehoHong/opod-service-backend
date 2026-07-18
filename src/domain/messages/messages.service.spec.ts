import { EventsService } from "../events/events.service";
import { InsufficientCreditsException } from "../credits/insufficient-credits.exception";
import { MessagesService } from "./messages.service";

type MessagesServiceCtor = new (
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

function createReplyStub() {
  return {
    createReply: jest.fn(
      async (input: { messages: Array<{ content: string }> }) =>
        `AI reply to: ${input.messages.at(-1)?.content}`,
    ),
  };
}

function createMessageStore(
  create: jest.Mock,
  history: Array<{ senderType: "user" | "character"; body: string }> = [
    { senderType: "user", body: "hello" },
  ],
) {
  return { create, findMany: jest.fn().mockResolvedValue(history) };
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
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "ai-1",
          }),
        },
        message: createMessageStore(create, [
          { senderType: "user", body: "previous question" },
          { senderType: "character", body: "previous answer" },
          { senderType: "user", body: "hello" },
        ]),
      },
      credits,
      { recordEvent: jest.fn().mockResolvedValue(undefined) },
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
      conversationId: "conversation-1",
      userId: "human-1",
      messages: [
        { role: "user", content: "previous question" },
        { role: "assistant", content: "previous answer" },
        { role: "user", content: "hello" },
      ],
      turnId: "message-human",
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
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "ai-1",
          }),
        },
        message: createMessageStore(create),
      },
      credits,
      { recordEvent: jest.fn().mockResolvedValue(undefined) },
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
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      { messageConversation: { upsert }, message: createMessageStore(create) },
      createCreditsStub(),
      { recordEvent: jest.fn().mockResolvedValue(undefined) },
      createReplyStub(),
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

  it("rejects malformed message cursors before loading conversation data", async () => {
    const hasCharacter = jest.fn();
    const findUnique = jest.fn();
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasCharacter },
      { messageConversation: { findUnique } },
      createCreditsStub(),
    );
    const cursor = Buffer.from(JSON.stringify({ id: "bad-id" })).toString(
      "base64url",
    );

    await expect(
      service.getMessagesPage({
        userId: "human-1",
        characterId: "ai-1",
        limit: 20,
        cursor,
      }),
    ).rejects.toThrow("Invalid cursor");
    expect(hasCharacter).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
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
      where: {
        userId: "human-1",
        character: { status: "active" },
      },
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

  it("rejects malformed conversation cursors before loading conversations", async () => {
    const findMany = jest.fn();
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasCharacter: jest.fn() },
      { messageConversation: { findMany } },
      createCreditsStub(),
    );
    const cursor = Buffer.from(JSON.stringify({ id: "bad-id" })).toString(
      "base64url",
    );

    await expect(
      service.listConversationsPage({
        userId: "human-1",
        limit: 20,
        cursor,
      }),
    ).rejects.toThrow("Invalid cursor");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects empty human messages", async () => {
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
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

  it("rejects missing human message bodies", async () => {
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasCharacter: jest.fn() },
      {},
      createCreditsStub(),
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: undefined as unknown as string,
      }),
    ).rejects.toThrow("Message body is required");
  });

  it("rejects inactive characters before reserving credits", async () => {
    const credits = createCreditsStub();
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasCharacter: jest.fn().mockResolvedValue(false) },
      {},
      credits,
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "character-1",
        body: "hello",
      }),
    ).rejects.toThrow("Character not found");
    expect(credits.reserveCredits).not.toHaveBeenCalled();
  });

  it("records a message event when a user messages a character", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const eventsService = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as EventsService;
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "character-1",
          }),
        },
        message: createMessageStore(
          jest
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
        ),
      },
      createCreditsStub(),
      eventsService,
      createReplyStub(),
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

  it("does not wait for the server message event before completing", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    let resolveEvent: (() => void) | undefined;
    const eventStored = new Promise<void>((resolve) => {
      resolveEvent = resolve;
    });
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "character-1",
          }),
        },
        message: createMessageStore(
          jest
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
        ),
      },
      createCreditsStub(),
      { recordEvent: jest.fn().mockReturnValue(eventStored) },
      createReplyStub(),
    );
    let completed = false;

    const sending = service
      .sendMessage({
        userId: "human-1",
        characterId: "character-1",
        body: "hello",
      })
      .then(() => {
        completed = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(completed).toBe(true);
    resolveEvent?.();
    await sending;
  });

  it("keeps a captured message successful when its server event fails", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const credits = createCreditsStub();
    const service = new (MessagesService as unknown as MessagesServiceCtor)(
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        messageConversation: {
          upsert: jest.fn().mockResolvedValue({
            id: "conversation-1",
            userId: "human-1",
            characterId: "character-1",
          }),
        },
        message: createMessageStore(
          jest
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
        ),
      },
      credits,
      { recordEvent: jest.fn().mockRejectedValue(new Error("event down")) },
      createReplyStub(),
    );

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "character-1",
        body: "hello",
      }),
    ).resolves.toMatchObject({
      conversationId: "conversation-1",
      messages: [
        { senderType: "user", body: "hello" },
        { senderType: "character", body: "AI reply to: hello" },
      ],
    });
    expect(credits.captureReservation).toHaveBeenCalledWith({
      reference: "chat_reply:test",
    });
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });
});
