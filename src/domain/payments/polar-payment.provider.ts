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
  }) {
    const page = await this.client().checkouts.list({
      externalCustomerId: input.userId,
      productId: input.providerProductId,
      sorting: ["-created_at"],
      limit: 100,
    });
    const checkout = page.result.items.find(
      (candidate) => candidate.metadata.purchase_id === input.purchaseId,
    );
    return checkout
      ? { checkoutId: checkout.id, checkoutUrl: checkout.url }
      : undefined;
  }

  async createCheckout(input: {
    purchaseId: string;
    userId: string;
    providerProductId: string;
    successUrl?: string;
    returnUrl?: string;
  }) {
    const checkout = await this.client().checkouts.create({
      products: [input.providerProductId],
      externalCustomerId: input.userId,
      metadata: { purchase_id: input.purchaseId },
      allowDiscountCodes: false,
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
          total_amount?: number;
          refunded_amount?: number;
          currency?: string;
          metadata?: Record<string, unknown>;
        };
      };
      const eventId = input.headers["webhook-id"];
      if (!eventId) throw new ForbiddenException("Invalid provider signature");
      if (event.type === "order.paid") {
        const purchaseId = String(event.data?.metadata?.purchase_id ?? "");
        if (!event.data?.id)
          throw new ForbiddenException("Invalid provider event");
        return {
          eventId,
          type: "paid",
          purchaseId,
          transactionId: event.data.id,
          providerProductId: event.data.product_id ?? undefined,
          amount: event.data.total_amount,
          currency: event.data.currency,
          occurredAt: new Date(event.timestamp ?? Date.now()),
        };
      }
      if (event.type === "order.refunded") {
        return {
          eventId,
          type: "refunded",
          transactionId: event.data?.id,
          amount: event.data?.refunded_amount,
          currency: event.data?.currency,
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
}
