import { EventsService } from "../events/events.service";
import { InsufficientCreditsException } from "../credits/insufficient-credits.exception";
import { MessagesService } from "./messages.service";

type MessagesServiceCtor = new (
  charactersService: unknown,
  prisma: unknown,
  creditsService: unknown,
  eventsService?: unknown,
) => MessagesService;

const createdAt = new Date("2026-06-30T00:00:00.000Z");

const humanMessage = {
  id: "message-human",
  conversationId: "conversation-1",
  senderType: "user" as const,
  body: "hello",
  createdAt,
};

const pendingJob = { turnId: "message-human", status: "queued" as const };

function createCreditsStub() {
  return {
    reserveCredits: jest.fn().mockResolvedValue({
      id: "reservation-1",
      reference: "chat_reply:test",
      status: "reserved",
      amount: 2,
    }),
    captureReservation: jest.fn(),
    releaseReservation: jest.fn().mockResolvedValue({
      id: "reservation-1",
      reference: "chat_reply:test",
      status: "released",
      amount: 2,
    }),
  };
}

/**
 * `$transaction`이 같은 스텁을 콜백에 넘긴다. 서비스가 트랜잭션 안에서 부르는
 * 호출과 밖에서 부르는 호출을 한 곳에서 확인할 수 있다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createPrismaStub(parts: Record<string, any> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stub: Record<string, any> = {
    messageConversation: {
      upsert: jest.fn().mockResolvedValue({
        id: "conversation-1",
        userId: "human-1",
        characterId: "ai-1",
      }),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    message: {
      create: jest.fn().mockResolvedValue(humanMessage),
      update: jest
        .fn()
        .mockResolvedValue({ ...humanMessage, replyJob: pendingJob }),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
    },
    messageReplyJob: {
      create: jest.fn().mockResolvedValue({ id: "job-1" }),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    serviceLog: { create: jest.fn().mockResolvedValue({}) },
    ...parts,
  };
  stub.$transaction = jest.fn((run: (tx: unknown) => unknown) => run(stub));
  return stub;
}

function createService(
  prisma: unknown,
  credits: unknown = createCreditsStub(),
  events: unknown = { recordEvent: jest.fn().mockResolvedValue(undefined) },
  characters: unknown = { hasCharacter: jest.fn().mockResolvedValue(true) },
) {
  return new (MessagesService as unknown as MessagesServiceCtor)(
    characters,
    prisma,
    credits,
    events,
  );
}

describe("MessagesService", () => {
  it("returns the user message as pending without generating a reply", async () => {
    const prisma = createPrismaStub();
    const credits = createCreditsStub();
    const service = createService(prisma, credits);

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
          turnId: "message-human",
          replyStatus: "pending",
        },
      ],
    });

    // 답변은 워커가 만든다. 여기서 캐릭터 메시지가 하나라도 생기면 다시 동기
    // 경로로 되돌아간 것이다.
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(prisma.messageReplyJob.create).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation-1",
        turnId: "message-human",
        reservationReference: "chat_reply:test",
      },
    });
    // TTL 없는 예약이어야 한다. 5분 TTL이면 생성이 길어질 때 답변 성공과 예약
    // 만료가 경합한다.
    expect(credits.reserveCredits).toHaveBeenCalledWith({
      userId: "human-1",
      actionType: "chat_reply",
      expiresAt: null,
    });
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  it("releases the reservation when the message cannot be stored", async () => {
    const prisma = createPrismaStub({
      message: {
        create: jest.fn().mockRejectedValue(new Error("db down")),
        update: jest.fn(),
      },
    });
    const credits = createCreditsStub();
    const service = createService(prisma, credits);

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "hello",
      }),
    ).rejects.toThrow("db down");
    // 잡아둔 크레딧을 돌려놓지 않으면 유저 잔액이 조용히 잠긴다.
    expect(credits.releaseReservation).toHaveBeenCalledWith({
      reference: "chat_reply:test",
    });
    expect(prisma.serviceLog.create).toHaveBeenCalled();
  });

  it("blocks the message before any write when credits are insufficient", async () => {
    const prisma = createPrismaStub();
    const credits = createCreditsStub();
    credits.reserveCredits.mockRejectedValue(
      new InsufficientCreditsException(),
    );
    const service = createService(prisma, credits);

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "hello",
      }),
    ).rejects.toThrow(InsufficientCreditsException);
    expect(prisma.messageConversation.upsert).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  it("creates the conversation, message, and job in one transaction", async () => {
    const prisma = createPrismaStub();
    const service = createService(prisma);

    await service.sendMessage({
      userId: "human-1",
      characterId: "ai-1",
      body: " hello ",
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.messageConversation.upsert).toHaveBeenCalledWith({
      where: {
        userId_characterId: { userId: "human-1", characterId: "ai-1" },
      },
      update: {},
      create: { userId: "human-1", characterId: "ai-1" },
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: {
        conversationId: "conversation-1",
        senderType: "user",
        body: "hello",
      },
      include: { replyJob: { select: { turnId: true, status: true } } },
    });
    // 대화 목록 정렬 키는 메시지 추가 지점에서 갱신된다.
    expect(prisma.messageConversation.update).toHaveBeenCalledWith({
      where: { id: "conversation-1" },
      data: { lastMessageAt: createdAt },
    });
  });

  it("returns a cursor page of messages with their reply status", async () => {
    const prisma = createPrismaStub({
      messageConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversation-1" }),
      },
      message: {
        findMany: jest.fn().mockResolvedValue([
          {
            ...humanMessage,
            replyJob: { turnId: "message-human", status: "running" },
          },
          {
            id: "message-ai",
            conversationId: "conversation-1",
            senderType: "character",
            body: "reply",
            createdAt,
            replyJob: { turnId: "message-human", status: "completed" },
          },
        ]),
      },
    });
    const service = createService(prisma);

    const page = await service.getMessagesPage({
      userId: "human-1",
      characterId: "ai-1",
      limit: 2,
    });

    // running은 내부 상태다. 앱에는 pending 하나로만 보여야 한다.
    expect(page.items).toEqual([
      expect.objectContaining({ id: "message-human", replyStatus: "pending" }),
      expect.objectContaining({ id: "message-ai", replyStatus: "completed" }),
    ]);
  });

  it("omits reply status for messages stored before the async workflow", async () => {
    const prisma = createPrismaStub({
      messageConversation: {
        findUnique: jest.fn().mockResolvedValue({ id: "conversation-1" }),
      },
      message: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...humanMessage, replyJob: null }]),
      },
    });
    const service = createService(prisma);

    const page = await service.getMessagesPage({
      userId: "human-1",
      characterId: "ai-1",
      limit: 20,
    });

    expect(page.items[0]).not.toHaveProperty("replyStatus");
    expect(page.items[0]).not.toHaveProperty("turnId");
  });

  it("rejects malformed message cursors before loading conversation data", async () => {
    const hasCharacter = jest.fn();
    const prisma = createPrismaStub();
    const service = createService(prisma, createCreditsStub(), undefined, {
      hasCharacter,
    });
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
    expect(prisma.messageConversation.findUnique).not.toHaveBeenCalled();
  });

  it("returns a cursor page of conversations", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "conversation-2",
        userId: "human-1",
        characterId: "ai-2",
        createdAt,
        lastReadAt: null,
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
            replyJob: null,
          },
        ],
      },
      {
        id: "conversation-1",
        userId: "human-1",
        characterId: "ai-1",
        createdAt,
        lastReadAt: null,
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
    // 미읽음 수는 대화별 groupBy 한 번으로 받아 해당 대화에만 실린다.
    const groupBy = jest
      .fn()
      .mockResolvedValue([
        { conversationId: "conversation-2", _count: { _all: 3 } },
      ]);
    const prisma = createPrismaStub({
      messageConversation: { findMany },
      message: { groupBy },
    });
    const service = createService(prisma);

    await expect(
      service.listConversationsPage({ userId: "human-1", limit: 1 }),
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
          unreadCount: 3,
        },
      ],
      nextCursor: expect.any(String),
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // 대화 시작 시각이 아니라 마지막 활동 기준 정렬이어야 한다.
        orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }],
      }),
    );
  });

  it("rejects malformed conversation cursors before loading conversations", async () => {
    const findMany = jest.fn();
    const prisma = createPrismaStub({ messageConversation: { findMany } });
    const service = createService(prisma);
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
    const service = createService(createPrismaStub());

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "   ",
      }),
    ).rejects.toThrow("Message body is required");
  });

  it("rejects missing human message bodies", async () => {
    const service = createService(createPrismaStub());

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
    const service = createService(createPrismaStub(), credits, undefined, {
      hasCharacter: jest.fn().mockResolvedValue(false),
    });

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
    const eventsService = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
    } as unknown as EventsService;
    const service = createService(
      createPrismaStub(),
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

  it("does not wait for the server message event before completing", async () => {
    let resolveEvent: (() => void) | undefined;
    const eventStored = new Promise<void>((resolve) => {
      resolveEvent = resolve;
    });
    const service = createService(createPrismaStub(), createCreditsStub(), {
      recordEvent: jest.fn().mockReturnValue(eventStored),
    });
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

  it("keeps a stored message successful when its server event fails", async () => {
    const credits = createCreditsStub();
    const service = createService(createPrismaStub(), credits, {
      recordEvent: jest.fn().mockRejectedValue(new Error("event down")),
    });

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "character-1",
        body: "hello",
      }),
    ).resolves.toMatchObject({
      conversationId: "conversation-1",
      messages: [{ senderType: "user", replyStatus: "pending" }],
    });
    expect(credits.releaseReservation).not.toHaveBeenCalled();
  });

  describe("retryReply", () => {
    it("requeues a failed job with a fresh reservation", async () => {
      const prisma = createPrismaStub({
        messageReplyJob: {
          findUnique: jest.fn().mockResolvedValue({
            id: "job-1",
            status: "failed",
            conversation: { userId: "human-1" },
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
      });
      const credits = createCreditsStub();
      const service = createService(prisma, credits);

      await expect(
        service.retryReply({
          userId: "human-1",
          turnId: "0198f0d5-0000-7000-8000-000000000001",
        }),
      ).resolves.toEqual({
        turnId: "0198f0d5-0000-7000-8000-000000000001",
        replyStatus: "pending",
      });
      expect(credits.reserveCredits).toHaveBeenCalledWith({
        userId: "human-1",
        actionType: "chat_reply",
        expiresAt: null,
      });
      const [[update]] = prisma.messageReplyJob.updateMany.mock.calls;
      // 시도 횟수와 기한을 초기화하지 않으면 재시도가 즉시 소진 상태로 죽는다.
      expect(update.data).toMatchObject({
        status: "queued",
        attemptCount: 0,
        deadlineAt: null,
        startedAt: null,
      });
    });

    it("hides another user's turn behind a 404", async () => {
      const prisma = createPrismaStub({
        messageReplyJob: {
          findUnique: jest.fn().mockResolvedValue({
            id: "job-1",
            status: "failed",
            conversation: { userId: "someone-else" },
          }),
          updateMany: jest.fn(),
        },
      });
      const credits = createCreditsStub();
      const service = createService(prisma, credits);

      await expect(
        service.retryReply({
          userId: "human-1",
          turnId: "0198f0d5-0000-7000-8000-000000000001",
        }),
      ).rejects.toThrow("Reply job not found");
      expect(credits.reserveCredits).not.toHaveBeenCalled();
    });

    it("refuses to retry a job that is still pending", async () => {
      const prisma = createPrismaStub({
        messageReplyJob: {
          findUnique: jest.fn().mockResolvedValue({
            id: "job-1",
            status: "running",
            conversation: { userId: "human-1" },
          }),
          updateMany: jest.fn(),
        },
      });
      const credits = createCreditsStub();
      const service = createService(prisma, credits);

      await expect(
        service.retryReply({
          userId: "human-1",
          turnId: "0198f0d5-0000-7000-8000-000000000001",
        }),
      ).rejects.toThrow("Reply job is not retryable");
      expect(credits.reserveCredits).not.toHaveBeenCalled();
    });

    it("releases the second reservation when concurrent retries race", async () => {
      const prisma = createPrismaStub({
        messageReplyJob: {
          findUnique: jest.fn().mockResolvedValue({
            id: "job-1",
            status: "failed",
            conversation: { userId: "human-1" },
          }),
          // 다른 요청이 먼저 failed를 벗겨간 상황.
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      });
      const credits = createCreditsStub();
      const service = createService(prisma, credits);

      await expect(
        service.retryReply({
          userId: "human-1",
          turnId: "0198f0d5-0000-7000-8000-000000000001",
        }),
      ).rejects.toThrow("Reply job is not retryable");
      // 진 쪽이 예약을 돌려놓지 않으면 재시도 한 번에 두 번 차감된다.
      expect(credits.releaseReservation).toHaveBeenCalledWith({
        reference: "chat_reply:test",
      });
    });

    it("treats a non-uuid turn id as not found", async () => {
      const prisma = createPrismaStub();
      const service = createService(prisma);

      await expect(
        service.retryReply({ userId: "human-1", turnId: "not-a-uuid" }),
      ).rejects.toThrow("Reply job not found");
      expect(prisma.messageReplyJob.findUnique).not.toHaveBeenCalled();
    });
  });
});
