import { ConflictException } from "@nestjs/common";
import { queryReturning } from "../../../test/drizzle-mock";
import { MessagesService } from "./messages.service";

const createdAt = new Date("2026-06-30T00:00:00.000Z");
const conversation = {
  id: "conversation-1",
  userId: "human-1",
  characterId: "ai-1",
  createdAt,
  lastReadAt: null,
  lastMessageAt: createdAt,
};
const humanMessage = {
  id: "message-human",
  conversationId: conversation.id,
  senderType: "user" as const,
  body: "hello",
  createdAt,
  replyJobId: null,
};
const linkedMessage = {
  ...humanMessage,
  replyJobId: "job-1",
  replyJob: { turnId: humanMessage.id, status: "queued" as const },
};

function harness(options: {
  selects?: unknown[][];
  inserts?: unknown[][];
  updates?: unknown[][];
  transactionError?: Error;
}) {
  const selects = [...(options.selects ?? [])];
  const inserts = [...(options.inserts ?? [])];
  const updates = [...(options.updates ?? [])];
  const client = {
    select: jest.fn(() => queryReturning(selects.shift() ?? [])),
    insert: jest.fn(() => queryReturning(inserts.shift() ?? [])),
    update: jest.fn(() => queryReturning(updates.shift() ?? [])),
    delete: jest.fn(() => queryReturning([])),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
  };
  const transaction = jest.fn(async (work: (tx: typeof client) => unknown) => {
    if (options.transactionError) throw options.transactionError;
    return work(client);
  });
  const database = { client: { ...client, transaction } };
  const credits = {
    reserveCredits: jest.fn().mockResolvedValue({
      id: "reservation-1",
      reference: "chat_reply:test",
      status: "reserved",
      amount: 2,
    }),
    releaseReservation: jest.fn().mockResolvedValue(undefined),
  };
  const events = { recordEvent: jest.fn().mockResolvedValue(undefined) };
  const service = new MessagesService(
    { hasCharacter: jest.fn().mockResolvedValue(true) } as never,
    database as never,
    credits as never,
    events as never,
  );
  return { service, client, transaction, credits, events };
}

describe("MessagesService", () => {
  it("stores a user turn and returns the pending reply immediately", async () => {
    const { service, transaction, events } = harness({
      inserts: [[conversation], [humanMessage], [{ id: "job-1" }]],
      updates: [[], [], []],
      selects: [[linkedMessage]],
    });

    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: " hello ",
      }),
    ).resolves.toEqual({
      conversationId: conversation.id,
      messages: [
        {
          id: humanMessage.id,
          conversationId: conversation.id,
          senderType: "user",
          body: "hello",
          createdAt: createdAt.toISOString(),
          turnId: humanMessage.id,
          replyStatus: "pending",
        },
      ],
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(events.recordEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "message_character" }),
    );
  });

  it("releases the reservation when the message transaction fails", async () => {
    const { service, credits } = harness({ transactionError: new Error("db down") });
    await expect(
      service.sendMessage({
        userId: "human-1",
        characterId: "ai-1",
        body: "hello",
      }),
    ).rejects.toThrow("db down");
    expect(credits.releaseReservation).toHaveBeenCalledWith({
      reference: "chat_reply:test",
    });
  });

  it("returns stored messages with the public reply status", async () => {
    const { service } = harness({
      selects: [[{ id: conversation.id }], [linkedMessage]],
    });
    await expect(
      service.getMessagesPage({
        userId: "human-1",
        characterId: "ai-1",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      items: [{ id: humanMessage.id, replyStatus: "pending" }],
    });
  });

  it("requeues a failed reply with a fresh reservation", async () => {
    const { service, credits } = harness({
      selects: [
        [
          {
            id: "job-1",
            status: "failed",
            conversationUserId: "human-1",
          },
        ],
      ],
      updates: [[{ id: "job-1" }]],
    });
    await expect(
      service.retryReply({
        userId: "human-1",
        turnId: "0198f0d5-0000-7000-8000-000000000001",
      }),
    ).resolves.toEqual({
      turnId: "0198f0d5-0000-7000-8000-000000000001",
      replyStatus: "pending",
    });
    expect(credits.reserveCredits).toHaveBeenCalledWith(
      expect.objectContaining({ expiresAt: null }),
    );
  });

  it("releases the new reservation when concurrent retries race", async () => {
    const { service, credits } = harness({
      selects: [
        [
          {
            id: "job-1",
            status: "failed",
            conversationUserId: "human-1",
          },
        ],
      ],
      updates: [[]],
    });
    await expect(
      service.retryReply({
        userId: "human-1",
        turnId: "0198f0d5-0000-7000-8000-000000000001",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(credits.releaseReservation).toHaveBeenCalled();
  });
});
