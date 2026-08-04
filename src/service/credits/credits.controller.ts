import { Body, Controller, Get, Headers, Post, Query } from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { CreditsService } from "../../domain/credits/credits.service";
import { parsePageQuery } from "../../domain/database/page";
import {
  CreditCheckInDto,
  CreditEntryPageDto,
  SpendCreditsDto,
} from "./credit.dto";

@Controller("credits")
export class CreditsController {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly authService: AuthService,
  ) {}

  @Post("debits")
  async spendCredits(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: SpendCreditsDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.spendCredits({ ...body, userId });
  }

  @Post("check-in")
  @ApiCreatedResponse({ type: CreditCheckInDto })
  async checkIn(@Headers("authorization") authorization?: string) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.checkIn({ userId });
  }

  @Get("balance")
  async getBalance(@Headers("authorization") authorization?: string) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.getBalance(userId);
  }

  @Get("ledger")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiOkResponse({ type: CreditEntryPageDto })
  async listEntries(
    @Headers("authorization") authorization?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.listEntriesPage(
      userId,
      parsePageQuery(cursor, limit),
    );
  }
}
