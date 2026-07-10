import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { CreditsService } from "../../domain/credits/credits.service";
import { parsePageQuery } from "../../domain/database/page";
import { CreditCheckInDto, CreditEntryPageDto } from "./credit.dto";

@Controller("credits")
export class CreditsController {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly authService: AuthService,
  ) {}

  @Post("checkout")
  async createCheckout(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Omit<Parameters<CreditsService["createCheckout"]>[0], "userId">,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.createCheckout({ ...body, userId });
  }

  // TODO(payment-provider): Replace the local stub with signature and amount
  // verification plus atomic, idempotent transitions before production use.
  @Post("payment-webhooks/:provider")
  async handlePaymentWebhook(
    @Param("provider") provider: string,
    @Body() body: Parameters<CreditsService["handlePaymentWebhook"]>[1],
  ) {
    return this.creditsService.handlePaymentWebhook(provider, body);
  }

  @Post("debits")
  async spendCredits(
    @Headers("authorization") authorization: string | undefined,
    @Body()
    body: Parameters<CreditsService["spendCredits"]>[0],
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

  @Get("purchases")
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  async listPurchases(
    @Headers("authorization") authorization?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.listPurchasesPage(
      userId,
      parsePageQuery(cursor, limit),
    );
  }
}
