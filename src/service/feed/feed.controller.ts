import { Controller, Get, Headers, Query } from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { FeedService } from "../../domain/feed/feed.service";
import { parsePageQuery } from "../pagination";

@Controller("feed")
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async getFeed(
    @Headers("authorization") authorization?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.feedService.getFeedPage(userId, parsePageQuery(cursor, limit));
  }
}
