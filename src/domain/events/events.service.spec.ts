import { queryReturning } from "../../../test/drizzle-mock";
import { EventsService } from "./events.service";

type ClientEventInput = {
  eventType: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
};

const userId = "00000000-0000-7000-8000-000000000001";
const postId = "00000000-0000-7000-8000-000000000011";

function createService(input?: {
  charactersService?: Record<string, unknown>;
  insert?: jest.Mock;
  postsService?: Record<string, unknown>;
}) {
  const insertQuery = queryReturning(undefined);
  const insert = input?.insert ?? jest.fn().mockReturnValue(insertQuery);
  const postsService = input?.postsService ?? {
    findPost: jest.fn(),
    hasPost: jest.fn(),
  };
  const service = new EventsService(
    postsService as never,
    (input?.charactersService ?? { findCharacter: jest.fn() }) as never,
    { client: { insert } } as never,
  );
  return { insert, insertQuery, postsService, service };
}

describe("EventsService", () => {
  it("does not accept an event until its Drizzle insert completes", async () => {
    let resolveInsert: (() => void) | undefined;
    const inserted = new Promise<void>((resolve) => {
      resolveInsert = resolve;
    });
    const insertQuery = queryReturning(inserted);
    const { service } = createService({
      insert: jest.fn().mockReturnValue(insertQuery),
    });
    let accepted = false;

    const recording = service
      .recordEvent({
        userId,
        eventType: "audit_event",
        targetType: "other",
        targetId: "target-1",
      })
      .then((result) => {
        accepted = true;
        return result;
      });
    await Promise.resolve();
    await Promise.resolve();

    expect(accepted).toBe(false);
    resolveInsert?.();
    await expect(recording).resolves.toEqual({ accepted: true });
  });

  it("propagates database insert failures", async () => {
    const failedQuery = queryReturning(
      Promise.reject(new Error("database unavailable")),
    );
    const { service } = createService({
      insert: jest.fn().mockReturnValue(failedQuery),
    });

    await expect(
      service.recordEvent({
        userId,
        eventType: "audit_event",
        targetType: "other",
        targetId: "target-1",
      }),
    ).rejects.toThrow("database unavailable");
  });

  it("does not fail an accepted event when preference updates fail", async () => {
    let preferenceAttempted!: () => void;
    const attempted = new Promise<void>((resolve) => {
      preferenceAttempted = resolve;
    });
    let insertCall = 0;
    const insert = jest.fn().mockImplementation(() => {
      insertCall += 1;
      if (insertCall === 1) {
        return queryReturning(undefined);
      }
      if (insertCall === 2) {
        return queryReturning([{ id: "hashtag-1" }]);
      }
      preferenceAttempted();
      return queryReturning(
        Promise.reject(new Error("preference write failed")),
      );
    });
    const { service } = createService({
      charactersService: {
        findCharacter: jest.fn().mockResolvedValue({ interests: ["film"] }),
      },
      insert,
    });

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
    const postsService = {
      hasPost: jest.fn().mockResolvedValue(true),
      findPost: jest.fn().mockResolvedValue(null),
    };
    const { insertQuery, service } = createService({ postsService });

    await expect(
      service.recordClientEvent(userId, {
        eventType: "post_open",
        targetType: "post",
        targetId: postId,
        metadata: { source: "feed" },
      }),
    ).resolves.toEqual({ accepted: true });
    expect(postsService.hasPost).toHaveBeenCalledWith(postId);
    expect(insertQuery.values).toHaveBeenCalledWith({
      userId,
      eventType: "post_open",
      targetType: "post",
      targetId: postId,
      metadata: { source: "feed" },
    });
  });

  it("ignores a client-supplied user ID", async () => {
    const { insertQuery, service } = createService({
      postsService: {
        hasPost: jest.fn().mockResolvedValue(true),
        findPost: jest.fn().mockResolvedValue(null),
      },
    });

    await service.recordClientEvent(userId, {
      userId: "spoofed-user",
      eventType: "feed_view",
      targetType: "post",
      targetId: postId,
    } as unknown as ClientEventInput);

    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
    );
  });

  it("rejects unsupported or missing client targets before inserting", async () => {
    const postsService = {
      hasPost: jest.fn().mockResolvedValue(false),
      findPost: jest.fn(),
    };
    const { insert, service } = createService({ postsService });

    await expect(
      service.recordClientEvent(userId, {
        eventType: "message_character",
        targetType: "character",
        targetId: "00000000-0000-7000-8000-000000000021",
      }),
    ).rejects.toThrow("Unsupported client event");
    await expect(
      service.recordClientEvent(userId, {
        eventType: "feed_view",
        targetType: "post",
        targetId: postId,
      }),
    ).rejects.toThrow("Event target not found");
    expect(insert).not.toHaveBeenCalled();
  });
});
