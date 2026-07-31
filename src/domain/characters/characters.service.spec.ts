import { CharactersService } from "./characters.service";

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

  it("lists and reads active characters through Prisma", async () => {
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
    const findMany = jest.fn().mockResolvedValue([characterRow]);
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: characterId })
      .mockResolvedValueOnce(characterRow);
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: characterId })
      .mockResolvedValueOnce(characterRow);
    const service = new (
      CharactersService as new (client: unknown) => CharactersService
    )({
      character: { findFirst, findMany, findUnique },
    });

    await expect(service.hasCharacter(characterId)).resolves.toBe(true);
    await expect(service.listCharacters()).resolves.toEqual([character]);
    await expect(service.findCharacter(characterId)).resolves.toEqual(
      character,
    );
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: characterId, status: "active" },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: characterId, status: "active" },
      select: {
        id: true,
        publicId: true,
        displayName: true,
        bio: true,
        interests: true,
        profileImageCropX: true,
        profileImageCropY: true,
        profileImageCropZoom: true,
        profileImage: {
          select: {
            url: true,
            storageKey: true,
            width: true,
            height: true,
          },
        },
      },
    });
  });

  it("treats malformed character IDs as missing without querying Prisma", async () => {
    const findFirst = jest.fn();
    const findUnique = jest.fn().mockResolvedValue({ id: "unexpected" });
    const service = new (
      CharactersService as new (client: unknown) => CharactersService
    )({
      character: { findFirst, findUnique },
    });

    await expect(service.hasCharacter("not-a-uuid")).resolves.toBe(false);
    await expect(service.findCharacter("not-a-uuid")).resolves.toBeNull();
    const nonStringId = { toString: 1 } as unknown as string;
    await expect(service.hasCharacter(nonStringId)).resolves.toBe(false);
    await expect(service.findCharacter(nonStringId)).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
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
    const findMany = jest.fn().mockResolvedValue([character]);
    const service = new (
      CharactersService as new (client: unknown) => CharactersService
    )({
      character: { findMany },
    });

    await expect(service.searchCharacters(" film ", 5)).resolves.toEqual([
      {
        id: "character-1",
        publicId: "arin",
        displayName: "Arin",
        bio: "playful film critic",
        interests: ["film"],
      },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
        take: 5,
      }),
    );
  });
});
