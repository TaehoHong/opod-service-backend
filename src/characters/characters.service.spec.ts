import { CharactersService } from "./characters.service";

function queryReturning<T>(rows: T) {
  const promise = Promise.resolve(rows);
  const query = {
    from: jest.fn(),
    leftJoin: jest.fn(),
    limit: jest.fn(),
    orderBy: jest.fn(),
    then: promise.then.bind(promise),
    where: jest.fn(),
  };
  for (const method of [
    query.from,
    query.leftJoin,
    query.limit,
    query.orderBy,
    query.where,
  ]) {
    method.mockReturnValue(query);
  }
  return query;
}

describe("CharactersService", () => {
  const previousS3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL;

  beforeAll(() => {
    process.env.S3_PUBLIC_BASE_URL = "https://cdn.example.com";
  });

  afterAll(() => {
    if (previousS3PublicBaseUrl === undefined) {
      delete process.env.S3_PUBLIC_BASE_URL;
    } else {
      process.env.S3_PUBLIC_BASE_URL = previousS3PublicBaseUrl;
    }
  });

  it("lists and reads active characters through Drizzle", async () => {
    const characterId = "00000000-0000-7000-8000-000000000001";
    const characterRow = {
      id: characterId,
      publicId: "arin",
      displayName: "Arin",
      bio: "playful",
      interests: ["art"],
      profileImageCropX: 0.25,
      profileImageCropY: 0.75,
      profileImageCropZoom: 1.5,
      profileImage: {
        url: "pod/profile/character/arin.png",
        storageKey: "pod/profile/character/arin.png",
        width: 1024,
        height: 1024,
      },
    };
    const character = {
      id: characterId,
      publicId: "arin",
      displayName: "Arin",
      bio: "playful",
      interests: ["art"],
      profileImage: {
        url: "https://cdn.example.com/pod/profile/character/arin.png",
        width: 1024,
        height: 1024,
        crop: { x: 0.25, y: 0.75, zoom: 1.5 },
      },
    };
    const queries = [
      queryReturning([{ id: characterId }]),
      queryReturning([characterRow]),
      queryReturning([characterRow]),
    ];
    const select = jest.fn().mockImplementation(() => queries.shift());
    const service = new (
      CharactersService as new (database: unknown) => CharactersService
    )({ client: { select } });

    await expect(service.hasCharacter(characterId)).resolves.toBe(true);
    await expect(service.listCharacters()).resolves.toEqual([character]);
    await expect(service.findCharacter(characterId)).resolves.toEqual(
      character,
    );
    expect(select).toHaveBeenCalledTimes(3);
    expect(queries).toHaveLength(0);
  });

  it("treats malformed character IDs as missing without querying Drizzle", async () => {
    const select = jest.fn();
    const service = new (
      CharactersService as new (database: unknown) => CharactersService
    )({ client: { select } });

    await expect(service.hasCharacter("not-a-uuid")).resolves.toBe(false);
    await expect(service.findCharacter("not-a-uuid")).resolves.toBeNull();
    const nonStringId = { toString: 1 } as unknown as string;
    await expect(service.hasCharacter(nonStringId)).resolves.toBe(false);
    await expect(service.findCharacter(nonStringId)).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("searches active characters by text", async () => {
    const character = {
      id: "character-1",
      publicId: "arin",
      displayName: "Arin",
      bio: "playful film critic",
      interests: ["film"],
      profileImageCropX: 0.5,
      profileImageCropY: 0.5,
      profileImageCropZoom: 1,
      profileImage: null,
    };
    const query = queryReturning([character]);
    const select = jest.fn().mockReturnValue(query);
    const service = new (
      CharactersService as new (database: unknown) => CharactersService
    )({ client: { select } });

    await expect(service.searchCharacters(" film ", 5)).resolves.toEqual([
      {
        id: "character-1",
        publicId: "arin",
        displayName: "Arin",
        bio: "playful film critic",
        interests: ["film"],
      },
    ]);
    expect(query.limit).toHaveBeenCalledWith(5);
  });
});
