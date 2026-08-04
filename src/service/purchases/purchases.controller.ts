import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { parsePageQuery } from "../../domain/database/page";
import { PurchasesService } from "../../domain/purchases/purchases.service";
import {
  CreatePurchaseCheckoutDto,
  RequestPurchaseRefundDto,
  VerifyInAppPurchaseDto,
} from "./purchases.dto";

@Controller("purchases")
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly auth: AuthService,
  ) {}

  @Get("products")
  async listProducts(
    @Query("channel") channel: "web" | "apple" | "google" = "web",
  ) {
    if (!(["web", "apple", "google"] as string[]).includes(channel)) {
      throw new BadRequestException("Invalid purchase channel");
    }
    return { items: await this.purchases.listProducts(channel) };
  }

  @Get("account-token")
  async accountToken(@Headers("authorization") authorization?: string) {
    return this.purchases.accountToken(
      await this.auth.userIdFromAuthorization(authorization),
    );
  }

  @Post("checkouts")
  async createCheckout(
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: CreatePurchaseCheckoutDto,
  ) {
    const userId = await this.auth.userIdFromAuthorization(authorization);
    return this.purchases.createCheckout({
      userId,
      idempotencyKey: idempotencyKey ?? "",
      ...body,
    });
  }

  @Post("in-app/apple/verify")
  async verifyApple(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: VerifyInAppPurchaseDto,
  ) {
    const userId = await this.auth.userIdFromAuthorization(authorization);
    return this.purchases.verifyInApp({ userId, channel: "apple", ...body });
  }

  @Post("in-app/google/verify")
  async verifyGoogle(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: VerifyInAppPurchaseDto,
  ) {
    const userId = await this.auth.userIdFromAuthorization(authorization);
    return this.purchases.verifyInApp({ userId, channel: "google", ...body });
  }

  @Get()
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  async list(
    @Headers("authorization") authorization?: string,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId = await this.auth.userIdFromAuthorization(authorization);
    return this.purchases.list(userId, parsePageQuery(cursor, limit));
  }

  @Get(":purchaseId/refund-quote")
  async refundQuote(
    @Headers("authorization") authorization: string | undefined,
    @Param("purchaseId") purchaseId: string,
  ) {
    const userId = await this.auth.userIdFromAuthorization(authorization);
    return this.purchases.refundQuote(userId, purchaseId);
  }

  @Post(":purchaseId/refunds")
  async requestRefund(
    @Headers("authorization") authorization: string | undefined,
    @Param("purchaseId") purchaseId: string,
    @Body() body: RequestPurchaseRefundDto,
  ) {
    const userId = await this.auth.userIdFromAuthorization(authorization);
    return this.purchases.requestRefund({ userId, purchaseId, ...body });
  }
}
