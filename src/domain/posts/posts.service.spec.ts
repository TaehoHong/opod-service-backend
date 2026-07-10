import { PostsService } from "./posts.service";

const s3PublicBaseUrl = "https://media.example.test";
let previousS3PublicBaseUrl: string | undefined;

describe("PostsService", () => {
  beforeEach(() => {
    previousS3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL;
    process.env.S3_PUBLIC_BASE_URL = s3PublicBaseUrl;
  });

  afterEach(() => {
    if (previousS3PublicBaseUrl === undefined) {
      delete process.env.S3_PUBLIC_BASE_URL;
    } else {
      process.env.S3_PUBLIC_BASE_URL = previousS3PublicBaseUrl;
    }
  });

  it("lists and reads posts with media through Prisma", async () => {
    const postId = "00000000-0000-7000-8000-000000000011";
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: postId,
      characterId: "character-1",
      contentType: "reel",
      content: "hello",
      createdAt,
      hashtags: [{ hashtag: { name: "art" } }],
      postMedia: [
        {
          media: {
            mediaType: "image",
            url: "pod/reels/character/character-1/a.png",
            storageKey: "pod/reels/character/character-1/a.png",
            width: 1024,
            height: 768,
            durationSeconds: null,
          },
        },
      ],
    };
    const findMany = jest.fn().mockResolvedValue([row]);
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce({ id: postId })
      .mockResolvedValueOnce(row);
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ id: postId })
      .mockResolvedValueOnce(row);
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: {
          findMany,
          findFirst,
          findUnique,
        },
      },
    );

    await expect(service.hasPost(postId)).resolves.toBe(true);
    await expect(service.listPosts()).resolves.toEqual([
      {
        id: postId,
        characterId: "character-1",
        contentType: "reel",
        content: "hello",
        media: [
          {
            mediaType: "image",
            url: `${s3PublicBaseUrl}/pod/reels/character/character-1/a.png`,
            width: 1024,
            height: 768,
          },
        ],
        hashtags: ["art"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    await expect(service.findPost(postId)).resolves.toMatchObject({
      id: postId,
      media: [{ mediaType: "image" }],
    });
    expect(findFirst).toHaveBeenNthCalledWith(1, {
      where: { id: postId, character: { status: "active" } },
      select: { id: true },
    });
    expect(findFirst).toHaveBeenNthCalledWith(2, {
      where: { id: postId, character: { status: "active" } },
      include: expect.any(Object),
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { character: { status: "active" } },
      }),
    );
  });

  it("treats malformed post IDs as missing without querying Prisma", async () => {
    const findFirst = jest.fn();
    const findUnique = jest.fn().mockResolvedValue({ id: "unexpected" });
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: { findFirst, findUnique },
      },
    );

    await expect(service.hasPost("not-a-uuid")).resolves.toBe(false);
    await expect(service.findPost("not-a-uuid")).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns a cursor page of posts", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-new",
      characterId: "character-1",
      contentType: "feed",
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
        contentType: "feed",
        content: "new",
        media: [],
        hashtags: ["art"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(page.nextCursor).not.toBe("post-new");
    expect(findMany).toHaveBeenCalledWith({
      where: { character: { status: "active" } },
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
      contentType: "feed",
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
        contentType: "feed",
        content: "new",
        media: [],
        hashtags: ["art"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(findMany).toHaveBeenCalledWith({
      where: {
        characterId: "character-1",
        character: { status: "active" },
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

  it("returns a cursor page of posts with filters", async () => {
    const characterId = "00000000-0000-7000-8000-000000000021";
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-filtered",
      characterId,
      contentType: "reel",
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
        characterId,
        hashtag: "film",
        mediaType: "image",
      }),
    ).resolves.toEqual({
      items: [
        {
          id: "post-filtered",
          characterId,
          contentType: "reel",
          content: "filtered",
          media: [],
          hashtags: ["film"],
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        characterId,
        character: { status: "active" },
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

  it("returns a cursor page of posts filtered by content type", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-reel",
      characterId: "character-1",
      contentType: "reel",
      content: "reel",
      createdAt,
      hashtags: [],
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
      service.listPostsPage({ limit: 1, contentType: "reel" }),
    ).resolves.toEqual({
      items: [
        {
          id: "post-reel",
          characterId: "character-1",
          contentType: "reel",
          content: "reel",
          media: [],
          hashtags: [],
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        character: { status: "active" },
        contentType: "reel",
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

  it("rejects invalid post content type filters", async () => {
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: {
          findMany: jest.fn(),
        },
      },
    );

    await expect(
      service.listPostsPage({
        limit: 1,
        contentType: "story" as Parameters<
          PostsService["listPostsPage"]
        >[0]["contentType"],
      }),
    ).rejects.toThrow("Invalid content type");
  });

  it("rejects malformed character ID filters before querying Prisma", async () => {
    const findMany = jest.fn();
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        post: { findMany },
      },
    );

    await expect(
      service.listPostsPage({ limit: 20, characterId: "bad-id" }),
    ).rejects.toThrow("Invalid character ID");
    expect(findMany).not.toHaveBeenCalled();
  });

  it("lists comments and reactions only from users or active characters", async () => {
    const commentFindMany = jest.fn().mockResolvedValue([]);
    const reactionFindMany = jest.fn().mockResolvedValue([]);
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postComment: { findMany: commentFindMany },
        postReaction: { findMany: reactionFindMany },
      },
    );
    const visibleAuthorWhere = {
      OR: [{ characterId: null }, { character: { status: "active" } }],
    };

    await expect(
      service.listPostCommentsPage("post-1", { limit: 20 }),
    ).resolves.toEqual({ items: [] });
    await expect(service.listPostReactions("post-1")).resolves.toEqual({
      items: [],
      counts: {},
    });
    expect(commentFindMany).toHaveBeenCalledWith({
      where: { postId: "post-1", ...visibleAuthorWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
    expect(reactionFindMany).toHaveBeenCalledWith({
      where: { postId: "post-1", ...visibleAuthorWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  });

  it("creates user comments with trimmed body", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const create = jest.fn().mockResolvedValue({
      id: "comment-1",
      postId: "post-1",
      userId: "user-1",
      characterId: null,
      body: "hello",
      createdAt,
    });
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postComment: {
          create,
        },
      },
    );

    await expect(
      service.createUserComment({
        postId: "post-1",
        userId: "user-1",
        body: " hello ",
      }),
    ).resolves.toEqual({
      id: "comment-1",
      postId: "post-1",
      userId: "user-1",
      body: "hello",
      createdAt: createdAt.toISOString(),
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        postId: "post-1",
        userId: "user-1",
        body: "hello",
      },
    });
  });

  it("rejects blank user comments", async () => {
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postComment: {
          create: jest.fn(),
        },
      },
    );

    await expect(
      service.createUserComment({
        postId: "post-1",
        userId: "user-1",
        body: " ",
      }),
    ).rejects.toThrow("Comment body is required");
  });

  it("rejects missing user comment bodies", async () => {
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postComment: {
          create: jest.fn(),
        },
      },
    );

    await expect(
      service.createUserComment({
        postId: "post-1",
        userId: "user-1",
        body: undefined as unknown as string,
      }),
    ).rejects.toThrow("Comment body is required");
  });

  it("creates user reactions idempotently", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const upsert = jest.fn().mockResolvedValue({
      id: "reaction-1",
      postId: "post-1",
      userId: "user-1",
      characterId: null,
      reactionType: "like",
      createdAt,
    });
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postReaction: {
          upsert,
        },
      },
    );

    await expect(
      service.createUserReaction({
        postId: "post-1",
        userId: "user-1",
        reactionType: " like ",
      }),
    ).resolves.toEqual({
      id: "reaction-1",
      postId: "post-1",
      userId: "user-1",
      reactionType: "like",
      createdAt: createdAt.toISOString(),
    });
    expect(upsert).toHaveBeenCalledWith({
      where: {
        postId_userId_reactionType: {
          postId: "post-1",
          userId: "user-1",
          reactionType: "like",
        },
      },
      update: {},
      create: {
        postId: "post-1",
        userId: "user-1",
        reactionType: "like",
      },
    });
  });

  it("deletes user reactions", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postReaction: {
          deleteMany,
        },
      },
    );

    await expect(
      service.deleteUserReaction({
        postId: "post-1",
        userId: "user-1",
        reactionType: "like",
      }),
    ).resolves.toEqual({
      postId: "post-1",
      userId: "user-1",
      reactionType: "like",
      deleted: true,
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        postId: "post-1",
        userId: "user-1",
        reactionType: "like",
      },
    });
  });

  it("rejects blank user reactions", async () => {
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postReaction: {
          upsert: jest.fn(),
        },
      },
    );

    await expect(
      service.createUserReaction({
        postId: "post-1",
        userId: "user-1",
        reactionType: " ",
      }),
    ).rejects.toThrow("Reaction type is required");
  });

  it("rejects missing user reaction bodies for create and delete", async () => {
    const service = new (PostsService as new (prisma: unknown) => PostsService)(
      {
        postReaction: {
          deleteMany: jest.fn(),
          upsert: jest.fn(),
        },
      },
    );
    const missingReaction = {
      postId: "post-1",
      userId: "user-1",
      reactionType: undefined as unknown as string,
    };

    await expect(service.createUserReaction(missingReaction)).rejects.toThrow(
      "Reaction type is required",
    );
    await expect(service.deleteUserReaction(missingReaction)).rejects.toThrow(
      "Reaction type is required",
    );
  });

  it("searches posts and hashtags by text", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const row = {
      id: "post-1",
      characterId: "character-1",
      contentType: "feed",
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
        contentType: "feed",
        content: "film diary",
        media: [],
        hashtags: ["film", "noir"],
        createdAt: createdAt.toISOString(),
      },
    ]);
    await expect(service.searchHashtags("fi", 5)).resolves.toEqual(["film"]);
    expect(postFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          character: { status: "active" },
        }),
      }),
    );
    expect(hashtagFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          name: { contains: "fi", mode: "insensitive" },
          posts: {
            some: { post: { character: { status: "active" } } },
          },
        },
      }),
    );
  });
});
