import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from "@nestjs/common";
import { decodeCursor, Page, PageInput, pageFromRows } from "../database/page";
import { EventsService } from "../events/events.service";
import { FollowsService } from "../follows/follows.service";
import { Post, PostsService } from "../posts/posts.service";

@Injectable()
export class FeedService {
  constructor(
    private readonly postsService: PostsService,
    private readonly followsService: FollowsService,
    @Optional()
    @Inject(EventsService)
    private readonly eventsService?: EventsService,
  ) {}

  async getFeed(userId?: string): Promise<Post[]> {
    const follows = userId
      ? await this.followsService.followedCharacterIdsFor(userId)
      : new Set<string>();
    const hashtagPreferences = userId
      ? ((await this.eventsService?.hashtagPreferencesFor(userId)) ?? new Map())
      : new Map();

    return (await this.postsService.listPosts())
      .filter((post) => post.contentType === "feed")
      .sort((left, right) => {
        const scoreWithFollowBoost = (post: Post) =>
          this.hashtagAffinityFor(post, hashtagPreferences) +
          (follows.has(post.characterId) ? 1 : 0);
        const scoreDelta =
          scoreWithFollowBoost(right) - scoreWithFollowBoost(left);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return right.createdAt.localeCompare(left.createdAt);
      });
  }

  async getFeedPage(
    userId: string | undefined,
    input: PageInput,
  ): Promise<Page<Post>> {
    const cursorId = decodeCursor(input.cursor);
    const posts = await this.getFeed(userId);
    const cursorIndex = cursorId
      ? posts.findIndex((post) => post.id === cursorId)
      : -1;

    if (cursorId && cursorIndex === -1) {
      throw new BadRequestException("Invalid cursor");
    }

    return pageFromRows(
      posts.slice(cursorIndex + 1, cursorIndex + input.limit + 2),
      input.limit,
    );
  }

  private hashtagAffinityFor(
    post: Post,
    hashtagPreferences: Map<string, number>,
  ): number {
    return post.hashtags.reduce(
      (score, hashtag) => score + (hashtagPreferences.get(hashtag) ?? 0),
      0,
    );
  }
}
