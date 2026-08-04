import { Controller, Headers, Param, Post, Req } from "@nestjs/common";
import { PurchasesService } from "../../domain/purchases/purchases.service";

@Controller("payments")
export class PaymentsController {
  constructor(private readonly purchases: PurchasesService) {}

  @Post("webhooks/:provider")
  handleWebhook(
    @Param("provider") pathProvider: string,
    @Headers() headers: Record<string, string>,
    @Req() request: { rawBody?: Buffer },
  ) {
    const provider = pathProvider === "google" ? "google_play" : pathProvider;
    return this.purchases.applyProviderEvent(provider, {
      body: request.rawBody ?? Buffer.alloc(0),
      headers,
    });
  }
}
