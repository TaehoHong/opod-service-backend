import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { CreditsService } from "../../domain/credits/credits.service";
import { parsePageQuery } from "../../domain/database/page";
import {
  CreateCheckoutDto,
  CreditCheckInDto,
  CreditEntryPageDto,
  CreditRefundDto,
  CreditRefundQuoteDto,
  LocalCreditRefundResultDto,
  PaymentWebhookDto,
  ReserveCreditRefundDto,
  SpendCreditsDto,
} from "./credit.dto";

@Controller("credits")
export class CreditsController {
  constructor(
    private readonly creditsService: CreditsService,
    private readonly authService: AuthService,
  ) {}

  @Post("checkout")
  async createCheckout(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreateCheckoutDto,
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
    @Body() body: PaymentWebhookDto,
  ) {
    return this.creditsService.handlePaymentWebhook(provider, body);
  }

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

  @Get("purchases/:purchaseId/refund-quote")
  @ApiParam({ name: "purchaseId" })
  @ApiOkResponse({ type: CreditRefundQuoteDto })
  async getRefundQuote(
    @Headers("authorization") authorization: string | undefined,
    @Param("purchaseId") purchaseId: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.getUserRefundQuote({ userId, purchaseId });
  }

  @Post("refunds")
  @ApiCreatedResponse({ type: CreditRefundDto })
  async reserveRefund(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ReserveCreditRefundDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.reserveUserRefund({ userId, ...body });
  }

  @Post("refunds/:refundId/release")
  @ApiParam({ name: "refundId" })
  @ApiCreatedResponse({ type: CreditRefundDto })
  async releaseRefund(
    @Headers("authorization") authorization: string | undefined,
    @Param("refundId") refundId: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.creditsService.releaseUserRefund({ userId, refundId });
  }

  // Local-only provider result stub. Production rejects it until a signed PG
  // refund callback replaces this endpoint.
  @Post("refund-webhooks/local")
  @ApiCreatedResponse({ type: CreditRefundDto })
  async handleLocalRefundResult(@Body() body: LocalCreditRefundResultDto) {
    return this.creditsService.handleLocalRefundResult(body);
  }
}
