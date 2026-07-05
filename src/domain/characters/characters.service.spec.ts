import { CharactersService } from "./characters.service";

describe("CharactersService", () => {
  it("lists and reads active characters through Prisma", async () => {
    const character = {
      id: "character-1",
      publicId: "arin",
      displayName: "Arin",
      bio: "playful",
      interests: ["art"],
    };
    const findMany = jest.fn().mockResolvedValue([character]);
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: "character-1" })
      .mockResolvedValueOnce(character);
    const service = new (
      CharactersService as new (client: unknown) => CharactersService
    )({
      character: { findMany, findUnique },
    });

    await expect(service.hasCharacter("character-1")).resolves.toBe(true);
    await expect(service.listCharacters()).resolves.toEqual([character]);
    await expect(service.findCharacter("character-1")).resolves.toEqual(
      character,
    );
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
