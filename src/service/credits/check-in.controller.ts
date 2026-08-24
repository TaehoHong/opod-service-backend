import { Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { CreditsService } from "../../domain/credits/credits.service";
import {
  CheckInQueryDto,
  CheckInStatusDto,
  CreditCheckInDto,
} from "./credit.dto";

@Controller("check-in")
export class CheckInController {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  @ApiOkResponse({ type: CheckInStatusDto })
  async status(
    @Headers("authorization") authorization: string | undefined,
    @Query() query: CheckInQueryDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.getCheckInStatus({ userId, month: query.month });
  }

  @Post()
  @ApiCreatedResponse({ type: CreditCheckInDto })
  async checkIn(@Headers("authorization") authorization?: string) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.checkIn({ userId });
  }
}
