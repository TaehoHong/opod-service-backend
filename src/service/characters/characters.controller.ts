import {
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { CharactersService } from "../../domain/characters/characters.service";
import { FollowsService } from "../../domain/follows/follows.service";
import { PostsService } from "../../domain/posts/posts.service";
import { parsePageQuery } from "../pagination";

@Controller("characters")
export class CharactersController {
  constructor(
    private readonly charactersService: CharactersService,
    private readonly postsService: PostsService,
    private readonly authService: AuthService,
    private readonly followsService: FollowsService,
  ) {}

  @Get()
  listCharacters() {
    return this.charactersService.listCharacters();
  }

  @Get(":id/posts")
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
