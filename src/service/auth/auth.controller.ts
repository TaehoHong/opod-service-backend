import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Patch,
  Post,
} from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(@Body() body: Parameters<AuthService["register"]>[0]) {
    return this.authService.register(body);
  }

  @Post("login")
  login(@Body() body: Parameters<AuthService["login"]>[0]) {
    return this.authService.login(body);
  }

  @Post("refresh")
  refresh(@Body() body: Parameters<AuthService["refresh"]>[0]) {
    return this.authService.refresh(body);
  }

  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.currentUserFromAuthorization(authorization);
  }

  @Patch("me")
  updateMe(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Parameters<AuthService["updateCurrentUserFromAuthorization"]>[1],
  ) {
    return this.authService.updateCurrentUserFromAuthorization(
      authorization,
      body,
    );
  }

  @Delete("me")
  deleteMe(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Parameters<AuthService["deleteAccountFromAuthorization"]>[1],
  ) {
    return this.authService.deleteAccountFromAuthorization(authorization, body);
  }

  @Patch("password")
  changePassword(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Parameters<AuthService["changePasswordFromAuthorization"]>[1],
  ) {
    return this.authService.changePasswordFromAuthorization(
      authorization,
      body,
    );
  }

  @Delete("session")
  revokeSession(
    @Body()
    body: {
      refreshToken: string;
    },
  ) {
    return this.authService.revokeRefreshToken(body.refreshToken);
  }
}
