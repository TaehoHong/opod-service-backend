import { Body, Controller, Delete, Get, Headers, Post } from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { FollowsService } from "../../domain/follows/follows.service";

@Controller("follows")
export class FollowsController {
  constructor(
    private readonly followsService: FollowsService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  async followCharacter(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Parameters<FollowsService["followCharacter"]>[0],
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
    @Body()
    body: Parameters<FollowsService["unfollowCharacter"]>[0],
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.followsService.unfollowCharacter({ ...body, userId });
  }
}
