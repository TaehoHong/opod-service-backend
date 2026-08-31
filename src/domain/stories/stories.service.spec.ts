import { StoriesService } from "./stories.service";

const s3PublicBaseUrl = "https://media.example.test";
let previousS3PublicBaseUrl: string | undefined;

function queryReturning<T>(rows: T) {
  const promise = Promise.resolve(rows);
  const query = {
    from: jest.fn(),
    innerJoin: jest.fn(),
    limit: jest.fn(),
    orderBy: jest.fn(),
    then: promise.then.bind(promise),
    where: jest.fn(),
  };
  for (const method of [
    query.from,
    query.innerJoin,
    query.limit,
    query.orderBy,
    query.where,
  ]) {
    method.mockReturnValue(query);
  }
  return query;
}

describe("StoriesService", () => {
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

  it("returns a cursor page of active stories with media", async () => {
    const createdAt = new Date("2026-06-30T00:00:00.000Z");
    const expiresAt = new Date("2999-06-30T00:00:00.000Z");
    const row = {
      id: "story-1",
      characterId: "character-1",
      caption: "today",
      createdAt,
      expiresAt,
      mediaType: "video",
      url: "pod/stories/character/character-1/story.mp4",
      storageKey: "pod/stories/character/character-1/story.mp4",
      width: 720,
      height: 1280,
      durationSeconds: 12,
    };
    const query = queryReturning([row, { ...row, id: "more" }]);
    const select = jest.fn().mockReturnValue(query);
    const service = new (
      StoriesService as new (database: unknown) => StoriesService
    )({ client: { select } });

    const page = await service.listStoriesPage({ limit: 1 });

    expect(page.items).toEqual([
      {
        id: "story-1",
        characterId: "character-1",
        caption: "today",
        media: {
          mediaType: "video",
          url: `${s3PublicBaseUrl}/pod/stories/character/character-1/story.mp4`,
          width: 720,
          height: 1280,
          durationSeconds: 12,
        },
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
    ]);
    expect(page.nextCursor).toEqual(expect.any(String));
    expect(query.limit).toHaveBeenCalledWith(2);
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
      mediaType: "image",
      url: "https://cdn.local/story.png",
      storageKey: null,
      width: null,
      height: null,
      durationSeconds: null,
    };
    const query = queryReturning([row]);
    const service = new (
      StoriesService as new (database: unknown) => StoriesService
    )({ client: { select: jest.fn().mockReturnValue(query) } });

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
    expect(query.limit).toHaveBeenCalledWith(21);
  });
});
