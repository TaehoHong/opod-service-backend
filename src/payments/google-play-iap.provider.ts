import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { GoogleAuth, OAuth2Client } from "google-auth-library";
import { PaymentEvent, PaymentProvider } from "./payment-provider";

type GoogleProductPurchase = {
  purchaseState?: number;
  consumptionState?: number;
  orderId?: string;
  purchaseTimeMillis?: string;
  obfuscatedExternalAccountId?: string;
  quantity?: number;
};

@Injectable()
export class GooglePlayIapProvider implements PaymentProvider {
  readonly name = "google_play";
  readonly channel = "google" as const;
  readonly environment = "production";

  private packageName() {
    const value = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim();
    if (!value) {
      throw new ServiceUnavailableException("Google Play is not configured");
    }
    return value;
  }

  private async client() {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/androidpublisher"],
    });
    return auth.getClient();
  }

  async verifyPurchase(input: {
    proof: string;
    expectedAccountToken: string;
    expectedProductId: string;
  }) {
    const token = input.proof.trim();
    if (!token) throw new BadRequestException("Purchase token is required");
    const packageName = this.packageName();
    const client = await this.client();
    const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(packageName)}/purchases/products/${encodeURIComponent(input.expectedProductId)}/tokens/${encodeURIComponent(token)}`;
    let purchase: GoogleProductPurchase;
    try {
      const response = await client.request<GoogleProductPurchase>({
        url: base,
      });
      purchase = response.data;
    } catch {
      throw new BadRequestException("Invalid Google Play purchase");
    }
    if (
      purchase.purchaseState !== 0 ||
      purchase.obfuscatedExternalAccountId !== input.expectedAccountToken ||
      (purchase.quantity ?? 1) !== 1
    ) {
      throw new BadRequestException("Google Play purchase does not match user");
    }
    if (purchase.consumptionState !== 1) {
      await client.request({ method: "POST", url: `${base}:consume` });
    }
    return {
      provider: this.name,
      channel: this.channel,
      transactionId:
        purchase.orderId ?? createHash("sha256").update(token).digest("hex"),
      transactionKey: createHash("sha256").update(token).digest("hex"),
      providerProductId: input.expectedProductId,
      environment: "production",
      occurredAt: new Date(Number(purchase.purchaseTimeMillis ?? Date.now())),
      revoked: false,
    };
  }

  async verifyEvent(input: {
    body: Buffer;
    headers: Record<string, string>;
  }): Promise<PaymentEvent> {
    const authorization = input.headers.authorization;
    const audience = process.env.GOOGLE_PLAY_PUBSUB_AUDIENCE?.trim();
    const expectedEmail =
      process.env.GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT?.trim();
    if (!authorization?.startsWith("Bearer ") || !audience || !expectedEmail) {
      throw new ForbiddenException("Invalid provider signature");
    }
    try {
      const ticket = await new OAuth2Client().verifyIdToken({
        idToken: authorization.slice(7),
        audience,
      });
      const payload = ticket.getPayload();
      if (payload?.email !== expectedEmail || payload.email_verified !== true) {
        throw new Error("Unexpected Pub/Sub identity");
      }
    } catch {
      throw new ForbiddenException("Invalid provider signature");
    }
    let envelope: {
      message?: { messageId?: string; publishTime?: string; data?: string };
    };
    try {
      envelope = JSON.parse(input.body.toString("utf8")) as typeof envelope;
    } catch {
      throw new BadRequestException("Invalid Google Play notification");
    }
    const message = envelope.message;
    if (!message?.messageId || !message.data) {
      throw new BadRequestException("Invalid Google Play notification");
    }
    let notification: {
      packageName?: string;
      oneTimeProductNotification?: {
        notificationType?: number;
        purchaseToken?: string;
        sku?: string;
      };
    };
    try {
      notification = JSON.parse(
        Buffer.from(message.data, "base64").toString("utf8"),
      ) as typeof notification;
    } catch {
      throw new BadRequestException("Invalid Google Play notification");
    }
    if (notification.packageName !== this.packageName()) {
      throw new ForbiddenException("Invalid Google Play package");
    }
    const oneTime = notification.oneTimeProductNotification;
    if (!oneTime?.purchaseToken) {
      return {
        eventId: message.messageId,
        type: "ignored",
        occurredAt: new Date(message.publishTime ?? Date.now()),
      };
    }
    return {
      eventId: message.messageId,
      type: oneTime.notificationType === 2 ? "reversed" : "paid",
      transactionKey: createHash("sha256")
        .update(oneTime.purchaseToken)
        .digest("hex"),
      providerProductId: oneTime.sku,
      occurredAt: new Date(message.publishTime ?? Date.now()),
    };
  }
}
