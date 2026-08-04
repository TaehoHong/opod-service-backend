import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PaymentEvent, PaymentProvider } from "./payment-provider";

@Injectable()
export class LocalPaymentProvider implements PaymentProvider {
  readonly name = "local";
  readonly channel = "web" as const;

  private assertAllowed() {
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException("Local payments are disabled");
    }
  }

  async createCheckout(input: { purchaseId: string }) {
    this.assertAllowed();
    return {
      checkoutId: input.purchaseId,
      checkoutUrl: `https://payments.local/checkout/${input.purchaseId}`,
    };
  }

  async verifyEvent(input: {
    body: Buffer;
    headers: Record<string, string>;
  }): Promise<PaymentEvent> {
    this.assertAllowed();
    let body: { purchaseId?: unknown; status?: unknown };
    try {
      body = JSON.parse(input.body.toString("utf8")) as typeof body;
    } catch {
      throw new BadRequestException("Invalid local payment event");
    }
    if (typeof body.purchaseId !== "string") {
      throw new BadRequestException("Purchase ID is required");
    }
    const status = body.status;
    if (status !== "paid" && status !== "failed" && status !== "refunded") {
      throw new BadRequestException("Unsupported payment status");
    }
    return {
      eventId: `local:${body.purchaseId}:${status}`,
      purchaseId: body.purchaseId,
      transactionId: body.purchaseId,
      type:
        status === "paid"
          ? "paid"
          : status === "refunded"
            ? "reversed"
            : "failed",
      occurredAt: new Date(),
    };
  }

  async requestRefund(input: {
    providerTransactionId: string;
    amount: number;
    refundId: string;
  }) {
    this.assertAllowed();
    return { providerRefundId: input.refundId, status: "succeeded" as const };
  }
}
