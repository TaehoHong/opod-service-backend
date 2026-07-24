import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Patch,
  Post,
} from "@nestjs/common";
import { ApiOkResponse } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import {
  AuthUserDto,
  ChangePasswordDto,
  DeleteAccountDto,
  LocalAdultVerificationDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  UpdateAuthUserDto,
} from "./auth.dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("register")
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Post("login")
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post("refresh")
  refresh(@Body() body: RefreshTokenDto) {
    return this.authService.refresh(body);
  }

  @Get("me")
  @ApiOkResponse({ type: AuthUserDto })
  me(@Headers("authorization") authorization?: string) {
    return this.authService.currentUserFromAuthorization(authorization);
  }

  @Patch("me")
  @ApiOkResponse({ type: AuthUserDto })
  updateMe(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: UpdateAuthUserDto,
  ) {
    return this.authService.updateCurrentUserFromAuthorization(
      authorization,
      body,
    );
  }

  @Delete("me")
  deleteMe(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: DeleteAccountDto,
  ) {
    return this.authService.deleteAccountFromAuthorization(authorization, body);
  }

  @Patch("password")
  changePassword(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ChangePasswordDto,
  ) {
    return this.authService.changePasswordFromAuthorization(
      authorization,
      body,
    );
  }

  // Local-only stand-in for a trusted adult-verification provider callback.
  @Post("adult-verifications/local")
  verifyAdultIdentity(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: LocalAdultVerificationDto,
  ) {
    return this.authService.verifyAdultIdentityFromAuthorization(
      authorization,
      body,
    );
  }

  @Delete("session")
  revokeSession(@Body() body: RefreshTokenDto) {
    return this.authService.revokeRefreshToken(body?.refreshToken);
  }
}
