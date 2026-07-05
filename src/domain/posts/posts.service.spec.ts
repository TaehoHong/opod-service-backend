import { PostsService } from "./posts.service";

describe("PostsService", () => {
  it("lists and reads posts with media through Prisma", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-1",
      characterId: "character-1",
      content: "hello",
      createdAt,
      hashtags: [{ hashtag: { name: "art" } }],
      postMedia: [
        {
          media: {
            mediaType: "image",
            url: "https://cdn.local/a.png",
            width: 1024,
            height: 768,
            durationSeconds: null,
          },
        },
      ],
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: "post-1" })
      .mockResolvedValueOnce(row);
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: {
          findMany,
          findUnique,
        },
      },
    );

    await expect(service.hasPost("post-1")).resolves.toBe(true);
    await expect(service.listPosts()).resolves.toEqual([
      {
        id: "post-1",
        characterId: "character-1",
        content: "hello",
        media: [
          {
            mediaType: "image",
            url: "https://cdn.local/a.png",
            width: 1024,
            height: 768,
          },
        ],
        hashtags: ["art"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    await expect(service.findPost("post-1")).resolves.toMatchObject({
      id: "post-1",
      media: [{ mediaType: "image" }],
    });
  });

  it("returns a cursor page of posts", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-new",
      characterId: "character-1",
      content: "new",
      createdAt,
      hashtags: [{ hashtag: { name: "art" } }],
      postMedia: [],
    };
    const findMany = jest.fn().mockResolvedValue([row, { ...row, id: "more" }]);
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: {
          findMany,
        },
      },
    );

    const page = await service.listPostsPage({ limit: 1 });

    expect(page.items).toEqual([
      {
        id: "post-new",
        characterId: "character-1",
        content: "new",
        media: [],
        hashtags: ["art"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.nextCursor).not.toBe("post-new");
    expect(findMany).toHaveBeenCalledWith({
      include: {
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
    });
  });

  it("returns a cursor page of posts for one character", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-new",
      characterId: "character-1",
      content: "new",
      createdAt,
      hashtags: [{ hashtag: { name: "art" } }],
      postMedia: [],
    };
    const findMany = jest.fn().mockResolvedValue([row, { ...row, id: "more" }]);
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: {
          findMany,
        },
      },
    );

    const page = await service.listCharacterPostsPage("character-1", {
      limit: 1,
    });

    expect(page.items).toEqual([
      {
        id: "post-new",
        characterId: "character-1",
        content: "new",
        media: [],
        hashtags: ["art"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(findMany).toHaveBeenCalledWith({
      where: { characterId: "character-1" },
      include: {
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
    });
  });

  it("returns a cursor page of posts with filters", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-filtered",
      characterId: "character-1",
      content: "filtered",
      createdAt,
      hashtags: [{ hashtag: { name: "film" } }],
      postMedia: [],
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: {
          findMany,
        },
      },
    );

    await expect(
      service.listPostsPage({
        limit: 1,
        characterId: "character-1",
        hashtag: "film",
        mediaType: "image",
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "post-filtered",
          characterId: "character-1",
          content: "filtered",
          media: [],
          hashtags: ["film"],
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        characterId: "character-1",
        hashtags: { some: { hashtag: { name: "film" } } },
        postMedia: {
          some: {
            media: {
              mediaType: "image",
            },
          },
        },
      },
      include: {
        hashtags: {
          include: { hashtag: true },
          orderBy: { hashtag: { name: "asc" } },
        },
        postMedia: {
          include: { media: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
    });
  });

  it("searches posts and hashtags by text", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-1",
      characterId: "character-1",
      content: "film diary",
      createdAt,
      hashtags: [{ hashtag: { name: "film" } }, { hashtag: { name: "noir" } }],
      postMedia: [],
    };
    const postFindMany = jest.fn().mockResolvedValue([row]);
    const hashtagFindMany = jest.fn().mockResolvedValue([{ name: "film" }]);
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        hashtag: { findMany: hashtagFindMany },
        post: { findMany: postFindMany },
      },
    );

    await expect(service.searchPosts("film", 5)).resolves.toEqual([
      {
        id: "post-1",
        characterId: "character-1",
        content: "film diary",
        media: [],
        hashtags: ["film", "noir"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    await expect(service.searchHashtags("fi", 5)).resolves.toEqual(["film"]);
  });
});
