import { EventsService } from "../events/events.service";
import { FollowsService } from "../follows/follows.service";
import { Post, PostsService } from "../posts/posts.service";
import { FeedService } from "./feed.service";

const media = [{ mediaType: "image" as const, url: "https://cdn.local/a.png" }];

describe("FeedService", () => {
  it("rejects malformed cursors before loading feed data", async () => {
    const listPosts = jest.fn();
    const followedCharacterIdsFor = jest.fn();
    const hashtagPreferencesFor = jest.fn();
    const feedService = new FeedService(
      { listPosts } as unknown as PostsService,
      { followedCharacterIdsFor } as unknown as FollowsService,
      { hashtagPreferencesFor } as unknown as EventsService,
    );
    const cursor = Buffer.from(JSON.stringify({ id: "bad-id" })).toString(
      "base64url",
    );

    await expect(
      feedService.getFeedPage("human-1", { limit: 20, cursor }),
    ).rejects.toThrow("Invalid cursor");
    expect(listPosts).not.toHaveBeenCalled();
    expect(followedCharacterIdsFor).not.toHaveBeenCalled();
    expect(hashtagPreferencesFor).not.toHaveBeenCalled();
  });

  it("returns a cursor page from the ranked feed", async () => {
    const highPost: Post = {
      id: "019f4970-b34a-7035-ad98-dfea56b29750",
      characterId: "character-1",
      contentType: "feed",
      content: "high",
      media,
      hashtags: ["film"],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const lowPost: Post = {
      id: "019f4970-b34a-7035-ad98-dfea56b29751",
      characterId: "character-1",
      contentType: "feed",
      content: "low",
      media,
      hashtags: [],
      createdAt: "2026-06-30T00:01:00.000Z",
    };
    const feedService = new FeedService(
      {
        listPosts: jest.fn().mockResolvedValue([lowPost, highPost]),
      } as unknown as PostsService,
      {
        followedCharacterIdsFor: jest.fn().mockResolvedValue(new Set()),
      } as unknown as FollowsService,
      {
        hashtagPreferencesFor: jest
          .fn()
          .mockResolvedValue(new Map([["film", 2]])),
      } as unknown as EventsService,
    );

    const firstPage = await feedService.getFeedPage("human-1", { limit: 1 });

    expect(firstPage.items.map((post: Post) => post.id)).toEqual([highPost.id]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await feedService.getFeedPage("human-1", {
      limit: 1,
      cursor: firstPage.nextCursor,
    });

    expect(secondPage.items.map((post: Post) => post.id)).toEqual([lowPost.id]);
  });

  it("returns newest posts for anonymous feed without personalization", async () => {
    const olderPost: Post = {
      id: "post-older",
      characterId: "character-1",
      contentType: "feed",
      content: "older",
      media,
      hashtags: ["film"],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const newerPost: Post = {
      id: "post-newer",
      characterId: "character-2",
      contentType: "feed",
      content: "newer",
      media,
      hashtags: [],
      createdAt: "2026-06-30T00:01:00.000Z",
    };
    const followedCharacterIdsFor = jest.fn();
    const hashtagPreferencesFor = jest.fn();
    const feedService = new FeedService(
      {
        listPosts: jest.fn().mockResolvedValue([olderPost, newerPost]),
      } as unknown as PostsService,
      { followedCharacterIdsFor } as unknown as FollowsService,
      { hashtagPreferencesFor } as unknown as EventsService,
    );

    await expect(
      feedService
        .getFeed(undefined)
        .then((posts) => posts.map((post) => post.id)),
    ).resolves.toEqual([newerPost.id, olderPost.id]);
    expect(followedCharacterIdsFor).not.toHaveBeenCalled();
    expect(hashtagPreferencesFor).not.toHaveBeenCalled();
  });

  it("does not include reel posts in the feed", async () => {
    const feedPost: Post = {
      id: "post-feed",
      characterId: "character-feed",
      contentType: "feed",
      content: "feed",
      media,
      hashtags: [],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const reelPost: Post = {
      id: "post-reel",
      characterId: "character-reel",
      contentType: "reel",
      content: "reel",
      media,
      hashtags: [],
      createdAt: "2026-06-30T00:01:00.000Z",
    };
    const feedService = new FeedService(
      {
        listPosts: jest.fn().mockResolvedValue([reelPost, feedPost]),
      } as unknown as PostsService,
      {
        followedCharacterIdsFor: jest.fn().mockResolvedValue(new Set()),
      } as unknown as FollowsService,
      {
        hashtagPreferencesFor: jest.fn().mockResolvedValue(new Map()),
      } as unknown as EventsService,
    );

    await expect(
      feedService
        .getFeed(undefined)
        .then((posts) => posts.map((post) => post.id)),
    ).resolves.toEqual(["post-feed"]);
  });

  it("boosts followed character posts in the feed", async () => {
    const followedPost: Post = {
      id: "post-followed",
      characterId: "character-followed",
      contentType: "feed",
      content: "followed",
      media,
      hashtags: [],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const otherPost: Post = {
      id: "post-other",
      characterId: "character-other",
      contentType: "feed",
      content: "other",
      media,
      hashtags: [],
      createdAt: "2026-06-30T00:01:00.000Z",
    };
    const feedService = new FeedService(
      {
        listPosts: jest.fn().mockResolvedValue([otherPost, followedPost]),
      } as unknown as PostsService,
      {
        followedCharacterIdsFor: jest
          .fn()
          .mockResolvedValue(new Set(["character-followed"])),
      } as unknown as FollowsService,
      {
        hashtagPreferencesFor: jest.fn().mockResolvedValue(new Map()),
      } as unknown as EventsService,
    );

    await expect(
      feedService
        .getFeed("human-1")
        .then((posts) => posts.map((post) => post.id)),
    ).resolves.toEqual([followedPost.id, otherPost.id]);
  });

  it("boosts posts that match a user's learned hashtag preferences", async () => {
    const olderArtPost: Post = {
      id: "post-art",
      characterId: "character-art",
      contentType: "feed",
      content: "gallery",
      media,
      hashtags: ["art"],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const newerTravelPost: Post = {
      id: "post-travel",
      characterId: "character-travel",
      contentType: "feed",
      content: "airport",
      media,
      hashtags: ["travel"],
      createdAt: "2026-06-30T00:01:00.000Z",
    };
    const feedService = new FeedService(
      {
        listPosts: jest.fn().mockResolvedValue([newerTravelPost, olderArtPost]),
      } as unknown as PostsService,
      {
        followedCharacterIdsFor: jest.fn().mockResolvedValue(new Set()),
      } as unknown as FollowsService,
      {
        hashtagPreferencesFor: jest
          .fn()
          .mockResolvedValue(new Map([["art", 2]])),
      } as unknown as EventsService,
    );

    await expect(
      feedService
        .getFeed("human-1")
        .then((posts) => posts.map((post) => post.id)),
    ).resolves.toEqual([olderArtPost.id, newerTravelPost.id]);
  });
});
