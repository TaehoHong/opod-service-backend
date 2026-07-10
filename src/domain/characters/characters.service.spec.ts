import { CharactersService } from "./characters.service";

describe("CharactersService", () => {
  it("lists and reads active characters through Prisma", async () => {
    const characterId = "00000000-0000-7000-8000-000000000001";
    const character = {
      id: characterId,
      publicId: "arin",
      displayName: "Arin",
      bio: "playful",
      interests: ["art"],
    };
    const findMany = jest.fn().mockResolvedValue([character]);
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: characterId })
      .mockResolvedValueOnce(character);
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: characterId })
      .mockResolvedValueOnce(character);
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
    };
    const findMany = jest.fn().mockResolvedValue([character]);
    const service = new (
      CharactersService as new (client: unknown) => CharactersService
    )({
      character: { findMany },
    });

    await expect(service.searchCharacters(" film ", 5)).resolves.toEqual([
      character,
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "active" }),
        take: 5,
      }),
    );
  });
});
