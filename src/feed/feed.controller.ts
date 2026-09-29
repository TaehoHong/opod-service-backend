import { Controller, Get, Headers, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../auth/auth.service";
import { FeedService } from "./feed.service";
import { parsePageQuery } from "../shared/utils/page";
import { PostPageDto } from "../posts/dto/post.dto";

@Controller("feed")
export class FeedController {
  constructor(
    private readonly feedService: FeedService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({
    type: PostPageDto,
    description: "Returns only posts with contentType=feed.",
  })
  async getFeed(
    @Headers("authorization") authorization?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId =
      await this.authService.optionalUserIdFromAuthorization(authorization);
    return this.feedService.getFeedPage(userId, parsePageQuery(cursor, limit));
  }
}
