import { queryReturning } from "../../../test/drizzle-mock";
import { PostsService } from "./posts.service";

const s3PublicBaseUrl = "https://media.example.test";
let previousS3PublicBaseUrl: string | undefined;

const createdAt = new Date("2026-06-30T00:00:00.000Z");
const postId = "00000000-0000-7000-8000-000000000011";
const postRow = {
  id: postId,
  characterId: "00000000-0000-7000-8000-000000000021",
  contentType: "reel",
  content: "hello",
  createdAt,
};
const mediaRow = {
  postId,
  mediaType: "image",
  url: "pod/reels/character/character-1/a.png",
  storageKey: "pod/reels/character/character-1/a.png",
  width: 1024,
  height: 768,
  durationSeconds: null,
};

function serviceWithSelectResults(...results: unknown[]) {
  const queries = results.map((result) => queryReturning(result));
  const select = jest.fn().mockImplementation(() => queries.shift());
  const service = new (PostsService as new (database: unknown) => PostsService)(
    { client: { select } },
  );
  return { queries, select, service };
}

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

  it("lists and reads active posts with hydrated media and hashtags", async () => {
    const { queries, service } = serviceWithSelectResults(
      [{ id: postId }],
      [postRow],
      [mediaRow],
      [{ postId, name: "art" }],
      [postRow],
      [mediaRow],
      [{ postId, name: "art" }],
    );
    const expected = {
      id: postId,
      characterId: postRow.characterId,
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
    };

    await expect(service.hasPost(postId)).resolves.toBe(true);
    await expect(service.listPosts()).resolves.toEqual([expected]);
    await expect(service.findPost(postId)).resolves.toEqual(expected);
    expect(queries).toHaveLength(0);
  });

  it("treats malformed post IDs as missing without querying Drizzle", async () => {
    const { select, service } = serviceWithSelectResults();

    await expect(service.hasPost("not-a-uuid")).resolves.toBe(false);
    await expect(service.findPost("not-a-uuid")).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("returns a cursor page after hydrating each post once", async () => {
    const second = { ...postRow, id: "00000000-0000-7000-8000-000000000012" };
    const { service } = serviceWithSelectResults(
      [postRow, second],
      [mediaRow],
      [{ postId, name: "art" }],
    );

    await expect(service.listPostsPage({ limit: 1 })).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: postId,
          media: [expect.objectContaining({ mediaType: "image" })],
          hashtags: ["art"],
        }),
      ],
      nextCursor: expect.any(String),
    });
  });

  it("rejects invalid filters before the base post query", async () => {
    const { select, service } = serviceWithSelectResults();

    await expect(
      service.listPostsPage({
        limit: 1,
        contentType: "story" as Parameters<
          PostsService["listPostsPage"]
        >[0]["contentType"],
      }),
    ).rejects.toThrow("Invalid content type");
    await expect(
      service.listPostsPage({ limit: 20, characterId: "bad-id" }),
    ).rejects.toThrow("Invalid character ID");
    expect(select).not.toHaveBeenCalled();
  });

  it("lists comments and reactions from visible authors", async () => {
    const comment = {
      id: "comment-1",
      postId,
      userId: "user-1",
      characterId: null,
      body: "hello",
      createdAt,
    };
    const reaction = {
      id: "reaction-1",
      postId,
      userId: "user-1",
      characterId: null,
      reactionType: "like",
      createdAt,
    };
    const { service } = serviceWithSelectResults([comment], [reaction]);

    await expect(
      service.listPostCommentsPage(postId, { limit: 20 }),
    ).resolves.toEqual({
      items: [
        {
          id: "comment-1",
          postId,
          userId: "user-1",
          body: "hello",
          createdAt: createdAt.toISOString(),
        },
      ],
    });
    await expect(service.listPostReactions(postId)).resolves.toEqual({
      items: [
        {
          id: "reaction-1",
          postId,
          userId: "user-1",
          reactionType: "like",
          createdAt: createdAt.toISOString(),
        },
      ],
      counts: { like: 1 },
    });
  });

  it("creates trimmed comments and rejects blank bodies", async () => {
    const query = queryReturning([
      {
        id: "comment-1",
        postId,
        userId: "user-1",
        characterId: null,
        body: "hello",
        createdAt,
      },
    ]);
    const service = new (
      PostsService as new (database: unknown) => PostsService
    )({ client: { insert: jest.fn().mockReturnValue(query) } });

    await expect(
      service.createUserComment({
        postId,
        userId: "user-1",
        body: " hello ",
      }),
    ).resolves.toMatchObject({ body: "hello", userId: "user-1" });
    expect(query.values).toHaveBeenCalledWith({
      postId,
      userId: "user-1",
      body: "hello",
    });
    await expect(
      service.createUserComment({ postId, userId: "user-1", body: " " }),
    ).rejects.toThrow("Comment body is required");
  });

  it("creates and deletes user reactions idempotently", async () => {
    const reaction = {
      id: "reaction-1",
      postId,
      userId: "user-1",
      characterId: null,
      reactionType: "like",
      createdAt,
    };
    const createQuery = queryReturning([reaction]);
    const deleteQuery = queryReturning([{ id: reaction.id }]);
    const service = new (
      PostsService as new (database: unknown) => PostsService
    )({
      client: {
        delete: jest.fn().mockReturnValue(deleteQuery),
        insert: jest.fn().mockReturnValue(createQuery),
      },
    });

    await expect(
      service.createUserReaction({
        postId,
        userId: "user-1",
        reactionType: " like ",
      }),
    ).resolves.toMatchObject({ reactionType: "like", userId: "user-1" });
    expect(createQuery.onConflictDoUpdate).toHaveBeenCalledTimes(1);
    await expect(
      service.deleteUserReaction({
        postId,
        userId: "user-1",
        reactionType: "like",
      }),
    ).resolves.toEqual({
      postId,
      userId: "user-1",
      reactionType: "like",
      deleted: true,
    });
  });

  it("searches hashtags used by active-character posts", async () => {
    const query = queryReturning([{ name: "film" }]);
    const service = new (
      PostsService as new (database: unknown) => PostsService
    )({ client: { select: jest.fn().mockReturnValue(query) } });

    await expect(service.searchHashtags(" fi ", 5)).resolves.toEqual(["film"]);
    expect(query.groupBy).toHaveBeenCalledTimes(1);
    expect(query.limit).toHaveBeenCalledWith(5);
  });
});
