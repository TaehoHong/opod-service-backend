import { EventsService } from "../events/events.service";
import { FollowsService } from "../follows/follows.service";
import { Post, PostsService } from "../posts/posts.service";
import { FeedService } from "./feed.service";

const media = [{ mediaType: "image" as const, url: "https://cdn.local/a.png" }];

describe("FeedService", () => {
  it("returns a cursor page from the ranked feed", async () => {
    const highPost: Post = {
      id: "post-high",
      characterId: "character-1",
      content: "high",
      media,
      hashtags: ["film"],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const lowPost: Post = {
      id: "post-low",
      characterId: "character-1",
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

    expect(firstPage.items.map((post: Post) => post.id)).toEqual(["post-high"]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await feedService.getFeedPage("human-1", {
      limit: 1,
      cursor: firstPage.nextCursor,
    });

    expect(secondPage.items.map((post: Post) => post.id)).toEqual(["post-low"]);
  });

  it("boosts followed character posts in the feed", async () => {
    const followedPost: Post = {
      id: "post-followed",
      characterId: "character-followed",
      content: "followed",
      media,
      hashtags: [],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const otherPost: Post = {
      id: "post-other",
      characterId: "character-other",
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
      content: "gallery",
      media,
      hashtags: ["art"],
      createdAt: "2026-06-30T00:00:00.000Z",
    };
    const newerTravelPost: Post = {
      id: "post-travel",
      characterId: "character-travel",
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
