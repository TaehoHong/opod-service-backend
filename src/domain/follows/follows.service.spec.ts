import { EventsService } from "../events/events.service";
import { FollowsService } from "./follows.service";

describe("FollowsService", () => {
  it("creates follows through Prisma upsert", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const upsert = jest.fn().mockResolvedValue({
      userId: "user-1",
      characterId: "character-1",
      createdAt,
    });
    const usersService = { hasUser: jest.fn().mockResolvedValue(true) };
    const charactersService = {
      hasCharacter: jest.fn().mockResolvedValue(true),
    };
    const ServiceWithClient = FollowsService as unknown as new (
      usersService: unknown,
      charactersService: unknown,
      prisma: unknown,
    ) => FollowsService;
    const service = new ServiceWithClient(usersService, charactersService, {
      userCharacterFollow: { upsert },
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
    expect(upsert).toHaveBeenCalledWith({
      where: {
        userId_characterId: {
          userId: "user-1",
          characterId: "character-1",
        },
      },
      update: {},
      create: {
        userId: "user-1",
        characterId: "character-1",
      },
    });
  });

  it("lists followed character ids through Prisma", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        userId: "user-1",
        characterId: "character-1",
        createdAt: new Date("2026-06-30T00:00:00.000Z"),
      },
    ]);
    const service = new (
      FollowsService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
      ) => FollowsService
    )(
      { hasUser: jest.fn() },
      { hasCharacter: jest.fn() },
      { userCharacterFollow: { findMany } },
    );

    await expect(service.followedCharacterIdsFor("user-1")).resolves.toEqual(
      new Set(["character-1"]),
    );
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        character: { status: "active" },
      },
      select: { characterId: true },
    });
  });

  it("lists follows for active characters only", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const findMany = jest.fn().mockResolvedValue([
      {
        userId: "user-1",
        characterId: "character-1",
        createdAt,
      },
    ]);
    const service = new (
      FollowsService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
      ) => FollowsService
    )(
      { hasUser: jest.fn() },
      { hasCharacter: jest.fn() },
      { userCharacterFollow: { findMany } },
    );

    await expect(service.listFollowedCharacters("user-1")).resolves.toEqual([
      {
        userId: "user-1",
        characterId: "character-1",
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        character: { status: "active" },
      },
      orderBy: { createdAt: "asc" },
    });
  });

  it("returns the current user relationship to a character", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const findUnique = jest.fn().mockResolvedValue({
      userId: "user-1",
      characterId: "character-1",
      createdAt,
    });
    const service = new (
      FollowsService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
      ) => FollowsService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      { userCharacterFollow: { findUnique } },
    );

    await expect(
      service.getCharacterRelationship({
        userId: "user-1",
        characterId: "character-1",
      }),
    ).resolves.toEqual({
      characterId: "character-1",
      isFollowing: true,
      followedAt: createdAt.toISOString(),
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_characterId: {
          userId: "user-1",
          characterId: "character-1",
        },
      },
    });
  });

  it("deletes follows through Prisma", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const usersService = { hasUser: jest.fn().mockResolvedValue(true) };
    const charactersService = {
      hasCharacter: jest.fn().mockResolvedValue(true),
    };
    const service = new (
      FollowsService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
      ) => FollowsService
    )(usersService, charactersService, {
      userCharacterFollow: { deleteMany },
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
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        characterId: "character-1",
      },
    });
  });

  it("records a follow event when a user follows a character", async () => {
    const eventsService = {
      recordEvent: jest.fn(),
    } as unknown as EventsService;
    const upsert = jest.fn().mockResolvedValue({
      userId: "human-1",
      characterId: "character-1",
      createdAt: new Date("2026-06-30T00:00:00.000Z"),
    });
    const service = new (
      FollowsService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService: unknown,
      ) => FollowsService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      { userCharacterFollow: { upsert } },
      eventsService,
    );

    await service.followCharacter({
      userId: "human-1",
      characterId: "character-1",
    });

    expect(eventsService.recordEvent).toHaveBeenCalledWith({
      userId: "human-1",
      eventType: "follow_character",
      targetType: "character",
      targetId: "character-1",
    });
  });

  it("waits for the server follow event before completing", async () => {
    let resolveEvent: (() => void) | undefined;
    const eventStored = new Promise<void>((resolve) => {
      resolveEvent = resolve;
    });
    const service = new (
      FollowsService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService: unknown,
      ) => FollowsService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      {
        userCharacterFollow: {
          upsert: jest.fn().mockResolvedValue({
            userId: "human-1",
            characterId: "character-1",
            createdAt: new Date("2026-06-30T00:00:00.000Z"),
          }),
        },
      },
      { recordEvent: jest.fn().mockReturnValue(eventStored) },
    );
    let completed = false;

    const following = service
      .followCharacter({ userId: "human-1", characterId: "character-1" })
      .then(() => {
        completed = true;
      });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(completed).toBe(false);
    resolveEvent?.();
    await following;
  });

  it("keeps a completed follow successful when its server event fails", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const upsert = jest.fn().mockResolvedValue({
      userId: "human-1",
      characterId: "character-1",
      createdAt,
    });
    const service = new (
      FollowsService as unknown as new (
        usersService: unknown,
        charactersService: unknown,
        prisma: unknown,
        eventsService: unknown,
      ) => FollowsService
    )(
      { hasUser: jest.fn().mockResolvedValue(true) },
      { hasCharacter: jest.fn().mockResolvedValue(true) },
      { userCharacterFollow: { upsert } },
      { recordEvent: jest.fn().mockRejectedValue(new Error("event down")) },
    );

    await expect(
      service.followCharacter({
        userId: "human-1",
        characterId: "character-1",
      }),
    ).resolves.toEqual({
      userId: "human-1",
      characterId: "character-1",
      createdAt: createdAt.toISOString(),
    });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
