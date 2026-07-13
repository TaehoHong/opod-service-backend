import { Body, Controller, Delete, Get, Headers, Post } from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { FollowsService } from "../../domain/follows/follows.service";
import { FollowCharacterDto } from "./follow.dto";

@Controller("follows")
export class FollowsController {
  constructor(
    private readonly followsService: FollowsService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  async followCharacter(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: FollowCharacterDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.followsService.followCharacter({ ...body, userId });
  }

  @Get()
  async listFollowedCharacters(
    @Headers("authorization") authorization?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.followsService.listFollowedCharacters(userId);
  }

  @Delete()
  async unfollowCharacter(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: FollowCharacterDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.followsService.unfollowCharacter({ ...body, userId });
  }
}
