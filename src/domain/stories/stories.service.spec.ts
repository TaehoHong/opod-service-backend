import { StoriesService } from "./stories.service";

describe("StoriesService", () => {
  it("returns a cursor page of active stories with media", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const expiresAt = new Date("2999-06-30T00:00:00.000Z");
    const row = {
      id: "story-1",
      characterId: "character-1",
      caption: "today",
      createdAt,
      expiresAt,
      media: {
        mediaType: "video",
        url: "https://cdn.local/story.mp4",
        width: 720,
        height: 1280,
        durationSeconds: 12,
      },
    };
    const findMany = jest.fn().mockResolvedValue([row, { ...row, id: "more" }]);
    const service = new (
      StoriesService as new (prisma: unknown) => StoriesService
    )({
      story: {
        findMany,
      },
    });

    const page = await service.listStoriesPage({ limit: 1 });

    expect(page.items).toEqual([
      {
        id: "story-1",
        characterId: "character-1",
        caption: "today",
        media: {
          mediaType: "video",
          url: "https://cdn.local/story.mp4",
          width: 720,
          height: 1280,
          durationSeconds: 12,
        },
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(findMany).toHaveBeenCalledWith({
      where: { expiresAt: { gt: expect.any(Date) } },
      include: { media: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
    });
  });

  it("returns active stories for one character", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const expiresAt = new Date("2999-06-30T00:00:00.000Z");
    const row = {
      id: "story-1",
      characterId: "character-1",
      caption: "",
      createdAt,
      expiresAt,
      media: {
        mediaType: "image",
        url: "https://cdn.local/story.png",
        width: null,
        height: null,
        durationSeconds: null,
      },
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const service = new (
      StoriesService as new (prisma: unknown) => StoriesService
    )({
      story: {
        findMany,
      },
    });

    await expect(
      service.listCharacterStoriesPage("character-1", { limit: 20 }),
    ).resolves.toEqual({
      items: [
        {
          id: "story-1",
          characterId: "character-1",
          caption: "",
          media: {
            mediaType: "image",
            url: "https://cdn.local/story.png",
          },
          createdAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        characterId: "character-1",
        expiresAt: { gt: expect.any(Date) },
      },
      include: { media: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
  });
});
