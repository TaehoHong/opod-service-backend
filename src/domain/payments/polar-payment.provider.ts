import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Polar } from "@polar-sh/sdk";
import { Webhook, WebhookVerificationError } from "standardwebhooks";
import {
  PaymentEvent,
  PaymentProvider,
  RefundResult,
} from "./payment-provider";

type PolarCurrency = NonNullable<
  Parameters<Polar["checkouts"]["create"]>[0]["currency"]
>;

@Injectable()
export class PolarPaymentProvider implements PaymentProvider {
  readonly name = "polar";
  readonly channel = "web" as const;

  get environment() {
    return process.env.POLAR_SERVER === "sandbox" ? "sandbox" : "production";
  }

  private client() {
    const accessToken = process.env.POLAR_ACCESS_TOKEN?.trim();
    if (!accessToken) {
      throw new ServiceUnavailableException("Polar is not configured");
    }
    return new Polar({
      accessToken,
      server: this.environment,
    });
  }

  async findCheckout(input: {
    purchaseId: string;
    userId: string;
    providerProductId: string;
    currency?: string;
  }) {
    const currency = this.currency(input.currency);
    const page = await this.client().checkouts.list({
      externalCustomerId: input.userId,
      productId: input.providerProductId,
      sorting: ["-created_at"],
      limit: 100,
    });
    const checkout = page.result.items.find(
      (candidate) =>
        candidate.metadata.purchase_id === input.purchaseId &&
        candidate.currency.toLowerCase() === currency,
    );
    return checkout
      ? { checkoutId: checkout.id, checkoutUrl: checkout.url }
      : undefined;
  }

  async createCheckout(input: {
    purchaseId: string;
    userId: string;
    providerProductId: string;
    currency?: string;
    customerIpAddress?: string;
    successUrl?: string;
    returnUrl?: string;
  }) {
    const checkout = await this.client().checkouts.create({
      products: [input.providerProductId],
      externalCustomerId: input.userId,
      metadata: { purchase_id: input.purchaseId },
      allowDiscountCodes: false,
      currency: this.currency(input.currency),
      customerIpAddress: input.customerIpAddress,
      successUrl: input.successUrl,
      returnUrl: input.returnUrl,
    });
    return { checkoutId: checkout.id, checkoutUrl: checkout.url };
  }

  async verifyEvent(input: {
    body: Buffer;
    headers: Record<string, string>;
  }): Promise<PaymentEvent> {
    const secret = process.env.POLAR_WEBHOOK_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException("Polar webhook is not configured");
    }
    try {
      const event = new Webhook(
        Buffer.from(secret, "utf8").toString("base64"),
      ).verify(input.body, input.headers) as {
        type?: string;
        timestamp?: string;
        data?: {
          id?: string;
          product_id?: string | null;
          net_amount?: number;
          tax_amount?: number;
          total_amount?: number;
          refunded_amount?: number;
          refunded_tax_amount?: number;
          currency?: string;
          metadata?: Record<string, unknown>;
        };
      };
      const eventId = input.headers["webhook-id"];
      if (!eventId) throw new ForbiddenException("Invalid provider signature");
      if (event.type === "order.paid") {
        const purchaseId = String(event.data?.metadata?.purchase_id ?? "");
        const netAmount = event.data?.net_amount;
        const taxAmount = event.data?.tax_amount;
        const totalAmount = event.data?.total_amount;
        const currency = event.data?.currency?.trim().toUpperCase();
        if (
          !event.data?.id ||
          typeof netAmount !== "number" ||
          !Number.isSafeInteger(netAmount) ||
          typeof taxAmount !== "number" ||
          !Number.isSafeInteger(taxAmount) ||
          typeof totalAmount !== "number" ||
          !Number.isSafeInteger(totalAmount) ||
          netAmount < 0 ||
          taxAmount < 0 ||
          totalAmount < 0 ||
          !currency
        ) {
          throw new ForbiddenException("Invalid provider event");
        }
        return {
          eventId,
          type: "paid",
          purchaseId,
          transactionId: event.data.id,
          providerProductId: event.data.product_id ?? undefined,
          netAmount,
          taxAmount,
          amount: totalAmount,
          currency,
          occurredAt: new Date(event.timestamp ?? Date.now()),
        };
      }
      if (event.type === "order.refunded") {
        const netAmount = event.data?.net_amount;
        const taxAmount = event.data?.tax_amount;
        const totalAmount = event.data?.total_amount;
        const refundedAmount = event.data?.refunded_amount;
        const refundedTaxAmount = event.data?.refunded_tax_amount;
        const currency = event.data?.currency?.trim().toUpperCase();
        if (
          !event.data?.id ||
          typeof netAmount !== "number" ||
          !Number.isSafeInteger(netAmount) ||
          typeof taxAmount !== "number" ||
          !Number.isSafeInteger(taxAmount) ||
          typeof totalAmount !== "number" ||
          !Number.isSafeInteger(totalAmount) ||
          typeof refundedAmount !== "number" ||
          !Number.isSafeInteger(refundedAmount) ||
          typeof refundedTaxAmount !== "number" ||
          !Number.isSafeInteger(refundedTaxAmount) ||
          netAmount <= 0 ||
          taxAmount < 0 ||
          totalAmount !== netAmount + taxAmount ||
          refundedAmount <= 0 ||
          refundedAmount > netAmount ||
          refundedTaxAmount < 0 ||
          refundedTaxAmount > taxAmount ||
          !currency
        ) {
          throw new ForbiddenException("Invalid provider event");
        }
        return {
          eventId,
          type: "refunded",
          transactionId: event.data.id,
          netAmount,
          taxAmount,
          refundedAmount,
          refundedTaxAmount,
          amount: refundedAmount,
          currency,
          occurredAt: new Date(event.timestamp ?? Date.now()),
        };
      }
      return {
        eventId,
        type: "ignored",
        occurredAt: new Date(event.timestamp ?? Date.now()),
      };
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        throw new ForbiddenException("Invalid provider signature");
      }
      throw error;
    }
  }

  async requestRefund(input: {
    providerTransactionId: string;
    amount: number;
    refundId: string;
  }): Promise<RefundResult> {
    const refund = await this.client().refunds.create({
      orderId: input.providerTransactionId,
      reason: "customer_request",
      amount: input.amount,
      metadata: { refund_id: input.refundId },
    });
    const rawStatus = String(refund.status);
    const status: RefundResult["status"] =
      rawStatus === "succeeded" ||
      rawStatus === "failed" ||
      rawStatus === "canceled"
        ? rawStatus
        : "processing";
    return {
      providerRefundId: refund.id,
      status,
    };
  }

  private currency(value?: string): PolarCurrency {
    const normalized = value?.trim().toLowerCase();
    if (!normalized || !/^[a-z]{3}$/.test(normalized)) {
      throw new ServiceUnavailableException(
        "Polar product currency is invalid",
      );
    }
    return normalized as PolarCurrency;
  }
}
