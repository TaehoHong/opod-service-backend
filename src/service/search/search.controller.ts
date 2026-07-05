import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from "@nestjs/common";
import { CharactersService } from "../../domain/characters/characters.service";
import { PostsService } from "../../domain/posts/posts.service";
import { parsePageQuery } from "../pagination";

type SearchTargetType = "character" | "post" | "hashtag";

@Controller("search")
export class SearchController {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly postsService: PostsService,
  ) {}

  @Get()
  async search(
    @Query("q") rawQuery?: string,
    @Query("targetType") rawTargetType?: string,
    @Query("limit") rawLimit?: string,
  ) {
    const query = this.parseQuery(rawQuery);
    const targetType = this.parseTargetType(rawTargetType);
    const limit = this.parseLimit(rawLimit);

    const [characters, posts, hashtags] = await Promise.all([
      this.shouldSearch(targetType, "character")
        ? this.charactersService.searchCharacters(query, limit)
        : [],
      this.shouldSearch(targetType, "post")
        ? this.postsService.searchPosts(query, limit)
        : [],
      this.shouldSearch(targetType, "hashtag")
        ? this.postsService.searchHashtags(query, limit)
        : [],
    ]);

    return { characters, posts, hashtags };
  }

  private parseQuery(rawQuery?: string): string {
    const query = (rawQuery ?? "").trim().replace(/^#+/, "");
    if (!query) {
      throw new BadRequestException("q is required");
    }
    return query;
  }

  private parseTargetType(
    rawTargetType?: string,
  ): SearchTargetType | undefined {
    if (!rawTargetType) {
      return undefined;
    }
    if (
      rawTargetType === "character" ||
      rawTargetType === "post" ||
      rawTargetType === "hashtag"
    ) {
      return rawTargetType;
    }
    throw new BadRequestException(
      "targetType must be character, post, or hashtag",
    );
  }

  private parseLimit(rawLimit?: string): number {
    if (!rawLimit) {
      return 10;
    }
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new BadRequestException("limit must be a positive integer");
    }
    return Math.min(limit, 50);
  }

  private shouldSearch(
    targetType: SearchTargetType | undefined,
    expected: SearchTargetType,
  ): boolean {
    return targetType === undefined || targetType === expected;
  }
}

@Controller("hashtags")
export class HashtagsController {
  constructor(private readonly postsService: PostsService) {}

  @Get(":tag/posts")
  listHashtagPosts(
    @Param("tag") rawTag: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const tag = rawTag.trim().replace(/^#+/, "");
    if (!tag) {
      throw new BadRequestException("tag is required");
    }

    return this.postsService.listPostsPage({
      ...parsePageQuery(cursor, limit),
      hashtag: tag,
    });
  }
}
