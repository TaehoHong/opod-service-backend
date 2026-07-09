import { Controller, Get, Query } from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { parsePageQuery } from "../../domain/database/page";
import { StoriesService } from "../../domain/stories/stories.service";
import { StoryPageDto } from "./story.dto";

@Controller("stories")
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Get()
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({
    type: StoryPageDto,
    description: "Returns active stories only.",
  })
  listStories(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.storiesService.listStoriesPage(parsePageQuery(cursor, limit));
  }
}
