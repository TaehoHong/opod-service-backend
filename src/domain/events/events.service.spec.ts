import { EventsService } from "./events.service";

type ClientEventInput = {
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
};

type EventsServiceWithClientEvents = EventsService & {
  recordClientEvent(
    userId: string,
    input: ClientEventInput,
  ): Promise<{ accepted: true }>;
};

const userId = "00000000-0000-7000-8000-000000000001";
const postId = "00000000-0000-7000-8000-000000000011";

describe("EventsService", () => {
  it("does not accept an event until its database insert completes", async () => {
    let resolveInsert: (() => void) | undefined;
    const inserted = new Promise<void>((resolve) => {
      resolveInsert = resolve;
    });
    const create = jest.fn().mockReturnValue(inserted);
    const service = new EventsService(
      { findPost: jest.fn() } as never,
      { findCharacter: jest.fn() } as never,
      { userEvent: { create } } as never,
    );
    let accepted = false;

    const recording = Promise.resolve(
      service.recordEvent({
        userId,
        eventType: "audit_event",
        targetType: "other",
        targetId: "target-1",
      }),
    ).then((result) => {
      accepted = true;
      return result;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(create).toHaveBeenCalledTimes(1);
    expect(accepted).toBe(false);
    resolveInsert?.();
    await expect(recording).resolves.toEqual({ accepted: true });
  });

  it("propagates database insert failures", async () => {
    const service = new EventsService(
      { findPost: jest.fn() } as never,
      { findCharacter: jest.fn() } as never,
      {
        userEvent: {
          create: jest
            .fn()
            .mockRejectedValue(new Error("database unavailable")),
        },
      } as never,
    );

    await expect(
      Promise.resolve(
        service.recordEvent({
          userId,
          eventType: "audit_event",
          targetType: "other",
          targetId: "target-1",
        }),
      ),
    ).rejects.toThrow("database unavailable");
  });

  it("does not fail an accepted event when preference updates fail", async () => {
    let preferenceAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => {
      preferenceAttempted = resolve;
    });
    const service = new EventsService(
      { findPost: jest.fn() } as never,
      {
        findCharacter: jest.fn().mockResolvedValue({ interests: ["film"] }),
      } as never,
      {
        userEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
        hashtag: {
          upsert: jest.fn().mockResolvedValue({ id: "hashtag-1" }),
        },
        userHashtagPreference: {
          upsert: jest.fn().mockImplementation(async () => {
            preferenceAttempted();
            throw new Error("preference write failed");
          }),
        },
      } as never,
    );

    await expect(
      service.recordEvent({
        userId,
        eventType: "follow_character",
        targetType: "character",
        targetId: "00000000-0000-7000-8000-000000000021",
      }),
    ).resolves.toEqual({ accepted: true });
    await attempted;
  });

  it("records supported client post events for the authenticated user", async () => {
    const create = jest.fn().mockResolvedValue({ id: "event-1" });
    const postsService = {
      hasPost: jest.fn().mockResolvedValue(true),
      findPost: jest.fn().mockResolvedValue(null),
    };
    const service = new EventsService(
      postsService as never,
      { findCharacter: jest.fn() } as never,
      { userEvent: { create } } as never,
    ) as EventsServiceWithClientEvents;

    await expect(
      Promise.resolve().then(() =>
        service.recordClientEvent(userId, {
          eventType: "post_open",
          targetType: "post",
          targetId: postId,
          metadata: { source: "feed" },
        }),
      ),
    ).resolves.toEqual({ accepted: true });
    expect(postsService.hasPost).toHaveBeenCalledWith(postId);
    expect(create).toHaveBeenCalledWith({
      data: {
        userId,
        eventType: "post_open",
        targetType: "post",
        targetId: postId,
        metadata: { source: "feed" },
      },
    });
  });

  it("ignores a client-supplied user ID", async () => {
    const create = jest.fn().mockResolvedValue({ id: "event-1" });
    const service = new EventsService(
      {
        hasPost: jest.fn().mockResolvedValue(true),
        findPost: jest.fn().mockResolvedValue(null),
      } as never,
      { findCharacter: jest.fn() } as never,
      { userEvent: { create } } as never,
    ) as EventsServiceWithClientEvents;

    await service.recordClientEvent(userId, {
      userId: "spoofed-user",
      eventType: "feed_view",
      targetType: "post",
      targetId: postId,
    } as unknown as ClientEventInput);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId }),
    });
  });

  it("rejects server-only event types from clients", async () => {
    const create = jest.fn();
    const postsService = { hasPost: jest.fn(), findPost: jest.fn() };
    const service = new EventsService(
      postsService as never,
      { findCharacter: jest.fn() } as never,
      { userEvent: { create } } as never,
    ) as EventsServiceWithClientEvents;

    await expect(
      Promise.resolve().then(() =>
        service.recordClientEvent(userId, {
          eventType: "message_character",
          targetType: "character",
          targetId: "00000000-0000-7000-8000-000000000021",
        }),
      ),
    ).rejects.toThrow("Unsupported client event");
    expect(postsService.hasPost).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects client post events with a non-post target type", async () => {
    const create = jest.fn();
    const postsService = { hasPost: jest.fn(), findPost: jest.fn() };
    const service = new EventsService(
      postsService as never,
      { findCharacter: jest.fn() } as never,
      { userEvent: { create } } as never,
    ) as EventsServiceWithClientEvents;

    await expect(
      service.recordClientEvent(userId, {
        eventType: "post_open",
        targetType: "character",
        targetId: "00000000-0000-7000-8000-000000000021",
      }),
    ).rejects.toThrow("Unsupported client event");
    expect(postsService.hasPost).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects client events for missing or inactive posts", async () => {
    const create = jest.fn();
    const postsService = {
      hasPost: jest.fn().mockResolvedValue(false),
      findPost: jest.fn(),
    };
    const service = new EventsService(
      postsService as never,
      { findCharacter: jest.fn() } as never,
      { userEvent: { create } } as never,
    ) as EventsServiceWithClientEvents;

    await expect(
      Promise.resolve().then(() =>
        service.recordClientEvent(userId, {
          eventType: "feed_view",
          targetType: "post",
          targetId: postId,
        }),
      ),
    ).rejects.toThrow("Event target not found");
    expect(create).not.toHaveBeenCalled();
  });
});
