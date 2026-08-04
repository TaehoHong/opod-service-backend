import { Module } from "@nestjs/common";
import { AppleIapProvider } from "./apple-iap.provider";
import { GooglePlayIapProvider } from "./google-play-iap.provider";
import { LocalPaymentProvider } from "./local-payment.provider";
import { PaymentsService } from "./payments.service";
import { PolarPaymentProvider } from "./polar-payment.provider";

@Module({
  providers: [
    PolarPaymentProvider,
    AppleIapProvider,
    GooglePlayIapProvider,
    LocalPaymentProvider,
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
