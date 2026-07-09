import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { CharactersService } from "../../domain/characters/characters.service";
import { FollowsService } from "../../domain/follows/follows.service";
import { PostsService } from "../../domain/posts/posts.service";
import { StoriesService } from "../../domain/stories/stories.service";
import { parsePageQuery } from "../../domain/database/page";
import { StoryPageDto } from "../stories/story.dto";

@Controller("characters")
export class CharactersController {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly postsService: PostsService,
    private readonly authService: AuthService,
    private readonly followsService: FollowsService,
    private readonly storiesService: StoriesService,
  ) {}

  @Get()
  listCharacters() {
    return this.charactersService.listCharacters();
  }

  @Get(":id/posts")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  async listCharacterPosts(
    @Param("id") characterId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    if (!(await this.charactersService.hasCharacter(characterId))) {
      throw new NotFoundException("Character not found");
    }
    return this.postsService.listCharacterPostsPage(
      characterId,
      parsePageQuery(cursor, limit),
    );
  }

  @Get(":id/stories")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({
    type: StoryPageDto,
    description: "Returns active stories for the character only.",
  })
  async listCharacterStories(
    @Param("id") characterId: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    if (!(await this.charactersService.hasCharacter(characterId))) {
      throw new NotFoundException("Character not found");
    }
    return this.storiesService.listCharacterStoriesPage(
      characterId,
      parsePageQuery(cursor, limit),
    );
  }

  @Get(":id/relationship")
  async getCharacterRelationship(
    @Param("id") characterId: string,
    @Headers("authorization") authorization: string | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.followsService.getCharacterRelationship({
      userId,
      characterId: characterId,
    });
  }

  @Get(":id")
  async getCharacter(@Param("id") characterId: string) {
    const character = await this.charactersService.findCharacter(characterId);
    if (!character) {
      throw new NotFoundException("Character not found");
    }
    return character;
  }
}
