import { queryReturning } from "../../../test/drizzle-mock";
import { EventsService } from "../events/events.service";
import { FollowsService } from "./follows.service";

const createdAt = new Date("2026-06-30T00:00:00.000Z");
const followRow = {
  userId: "user-1",
  characterId: "character-1",
  createdAt,
  notifiedUpToAt: createdAt,
};

function createService(input?: {
  client?: Record<string, unknown>;
  eventsService?: Partial<EventsService>;
}) {
  const usersService = { hasUser: jest.fn().mockResolvedValue(true) };
  const charactersService = {
    hasCharacter: jest.fn().mockResolvedValue(true),
  };
  const service = new (
    FollowsService as unknown as new (
      usersService: unknown,
      charactersService: unknown,
      database: unknown,
      eventsService?: unknown,
    ) => FollowsService
  )(
    usersService,
    charactersService,
    { client: input?.client ?? {} },
    input?.eventsService,
  );
  return { charactersService, service, usersService };
}

describe("FollowsService", () => {
  it("creates follows through a Drizzle upsert", async () => {
    const query = queryReturning([followRow]);
    const { service } = createService({
      client: { insert: jest.fn().mockReturnValue(query) },
    });

    await expect(
      service.followCharacter({
        userId: "user-1",
        characterId: "character-1",
      }),
    ).resolves.toEqual({
      userId: "user-1",
      characterId: "character-1",
      createdAt: createdAt.toISOString(),
    });
    expect(query.values).toHaveBeenCalledWith({
      userId: "user-1",
      characterId: "character-1",
    });
    expect(query.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("lists followed character ids for active characters", async () => {
    const query = queryReturning([{ characterId: "character-1" }]);
    const { service } = createService({
      client: { select: jest.fn().mockReturnValue(query) },
    });

    await expect(service.followedCharacterIdsFor("user-1")).resolves.toEqual(
      new Set(["character-1"]),
    );
    expect(query.innerJoin).toHaveBeenCalledTimes(1);
  });

  it("lists follows oldest first", async () => {
    const query = queryReturning([followRow]);
    const { service } = createService({
      client: { select: jest.fn().mockReturnValue(query) },
    });

    await expect(service.listFollowedCharacters("user-1")).resolves.toEqual([
      {
        userId: "user-1",
        characterId: "character-1",
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(query.orderBy).toHaveBeenCalledTimes(1);
  });

  it("returns the current relationship and agent-owned bond level", async () => {
    const queries = [
      queryReturning([followRow]),
      queryReturning([{ bondLevel: 4 }]),
    ];
    const { service } = createService({
      client: {
        select: jest.fn().mockImplementation(() => queries.shift()),
      },
    });

    await expect(
      service.getCharacterRelationship({
        userId: "user-1",
        characterId: "character-1",
      }),
    ).resolves.toEqual({
      characterId: "character-1",
      isFollowing: true,
      followedAt: createdAt.toISOString(),
      bondLevel: 4,
    });
  });

  it("reports level 1 when the two have never talked", async () => {
    const queries = [queryReturning([]), queryReturning([])];
    const { service } = createService({
      client: {
        select: jest.fn().mockImplementation(() => queries.shift()),
      },
    });

    await expect(
      service.getCharacterRelationship({
        userId: "user-1",
        characterId: "character-1",
      }),
    ).resolves.toEqual({
      characterId: "character-1",
      isFollowing: false,
      bondLevel: 1,
    });
  });

  it("deletes follows through Drizzle", async () => {
    const query = queryReturning([{ characterId: "character-1" }]);
    const { service } = createService({
      client: { delete: jest.fn().mockReturnValue(query) },
    });

    await expect(
      service.unfollowCharacter({
        userId: "user-1",
        characterId: "character-1",
      }),
    ).resolves.toEqual({
      userId: "user-1",
      characterId: "character-1",
      deleted: true,
    });
    expect(query.returning).toHaveBeenCalledTimes(1);
  });

  it("records and waits for the server follow event", async () => {
    let resolveEvent: (() => void) | undefined;
    const eventStored = new Promise<void>((resolve) => {
      resolveEvent = resolve;
    });
    const recordEvent = jest.fn().mockReturnValue(eventStored);
    const query = queryReturning([followRow]);
    const { service } = createService({
      client: { insert: jest.fn().mockReturnValue(query) },
      eventsService: { recordEvent } as Partial<EventsService>,
    });
    let completed = false;

    const following = service
      .followCharacter({ userId: "user-1", characterId: "character-1" })
      .then(() => {
        completed = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(recordEvent).toHaveBeenCalledWith({
      userId: "user-1",
      eventType: "follow_character",
      targetType: "character",
      targetId: "character-1",
    });
    expect(completed).toBe(false);
    resolveEvent?.();
    await following;
  });

  it("keeps a completed follow successful when its event fails", async () => {
    const query = queryReturning([followRow]);
    const { service } = createService({
      client: { insert: jest.fn().mockReturnValue(query) },
      eventsService: {
        recordEvent: jest.fn().mockRejectedValue(new Error("event down")),
      } as Partial<EventsService>,
    });

    await expect(
      service.followCharacter({
        userId: "user-1",
        characterId: "character-1",
      }),
    ).resolves.toEqual({
      userId: "user-1",
      characterId: "character-1",
      createdAt: createdAt.toISOString(),
    });
  });
});
