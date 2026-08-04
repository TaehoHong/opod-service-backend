import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { AppleIapProvider } from "./apple-iap.provider";
import { GooglePlayIapProvider } from "./google-play-iap.provider";
import { LocalPaymentProvider } from "./local-payment.provider";
import { PaymentChannel, PaymentProvider } from "./payment-provider";
import { PolarPaymentProvider } from "./polar-payment.provider";

@Injectable()
export class PaymentsService {
  private readonly providers: PaymentProvider[];

  constructor(
    polar: PolarPaymentProvider,
    apple: AppleIapProvider,
    google: GooglePlayIapProvider,
    local: LocalPaymentProvider,
  ) {
    this.providers = [polar, apple, google, local];
  }

  webProvider() {
    const name =
      process.env.PAYMENT_WEB_PROVIDER?.trim() ||
      (process.env.NODE_ENV === "production" ? "polar" : "local");
    return this.provider(name);
  }

  provider(name: string) {
    const provider = this.providers.find(
      (candidate) => candidate.name === name,
    );
    if (!provider)
      throw new ServiceUnavailableException("Payment provider is unavailable");
    return provider;
  }

  providerForChannel(channel: PaymentChannel) {
    if (channel === "web") return this.webProvider();
    return this.providers.find((provider) => provider.channel === channel)!;
  }

  async createCheckout(
    providerName: string,
    input: Parameters<NonNullable<PaymentProvider["createCheckout"]>>[0],
  ) {
    const method = this.provider(providerName).createCheckout;
    if (!method)
      throw new BadRequestException("Provider does not support checkout");
    return method.call(this.provider(providerName), input);
  }

  async findCheckout(
    providerName: string,
    input: Parameters<NonNullable<PaymentProvider["createCheckout"]>>[0],
  ) {
    const provider = this.provider(providerName);
    return provider.findCheckout?.(input);
  }

  async verifyPurchase(
    channel: "apple" | "google",
    input: Parameters<NonNullable<PaymentProvider["verifyPurchase"]>>[0],
  ) {
    const provider = this.providerForChannel(channel);
    if (!provider.verifyPurchase) {
      throw new BadRequestException(
        "Provider does not support in-app purchases",
      );
    }
    return provider.verifyPurchase(input);
  }

  async verifyEvent(
    providerName: string,
    input: Parameters<NonNullable<PaymentProvider["verifyEvent"]>>[0],
  ) {
    const provider = this.provider(providerName);
    if (!provider.verifyEvent) {
      throw new BadRequestException("Provider does not support webhooks");
    }
    return provider.verifyEvent(input);
  }

  async requestRefund(
    providerName: string,
    input: Parameters<NonNullable<PaymentProvider["requestRefund"]>>[0],
  ) {
    const provider = this.provider(providerName);
    if (!provider.requestRefund) {
      throw new BadRequestException("Provider does not support refunds");
    }
    return provider.requestRefund(input);
  }
}
