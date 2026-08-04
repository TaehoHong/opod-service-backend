import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  Environment,
  SignedDataVerifier,
} from "@apple/app-store-server-library";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { PaymentEvent, PaymentProvider } from "./payment-provider";

@Injectable()
export class AppleIapProvider implements PaymentProvider {
  readonly name = "apple";
  readonly channel = "apple" as const;

  get environment() {
    return process.env.APPLE_ENVIRONMENT === "production"
      ? "production"
      : "sandbox";
  }

  private verifier() {
    const bundleId = process.env.APPLE_BUNDLE_ID?.trim();
    const certificatePaths = process.env.APPLE_ROOT_CA_PATHS?.split(",")
      .map((path) => path.trim())
      .filter(Boolean);
    if (!bundleId || !certificatePaths?.length) {
      throw new ServiceUnavailableException("Apple IAP is not configured");
    }
    const production = this.environment === "production";
    const appAppleId = production
      ? Number(process.env.APPLE_APP_ID)
      : undefined;
    if (production && !Number.isSafeInteger(appAppleId)) {
      throw new ServiceUnavailableException("Apple app ID is not configured");
    }
    return new SignedDataVerifier(
      certificatePaths.map((path) => readFileSync(path)),
      true,
      production ? Environment.PRODUCTION : Environment.SANDBOX,
      bundleId,
      appAppleId,
    );
  }

  async verifyPurchase(input: {
    proof: string;
    expectedAccountToken: string;
    expectedProductId: string;
  }) {
    let transaction;
    try {
      transaction = await this.verifier().verifyAndDecodeTransaction(
        input.proof,
      );
    } catch {
      throw new BadRequestException("Invalid Apple transaction");
    }
    if (
      !transaction.transactionId ||
      transaction.productId !== input.expectedProductId ||
      transaction.appAccountToken?.toLowerCase() !==
        input.expectedAccountToken.toLowerCase() ||
      transaction.quantity !== 1
    ) {
      throw new BadRequestException(
        "Apple transaction does not match purchase",
      );
    }
    return {
      provider: this.name,
      channel: this.channel,
      transactionId: transaction.transactionId,
      transactionKey: createHash("sha256")
        .update(transaction.transactionId)
        .digest("hex"),
      providerProductId: transaction.productId,
      environment: String(transaction.environment ?? ""),
      currency: transaction.currency,
      occurredAt: new Date(transaction.purchaseDate ?? Date.now()),
      revoked: transaction.revocationDate !== undefined,
    };
  }

  async verifyEvent(input: {
    body: Buffer;
    headers: Record<string, string>;
  }): Promise<PaymentEvent> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.body.toString("utf8"));
    } catch {
      throw new BadRequestException("Invalid Apple notification");
    }
    const signedPayload =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { signedPayload?: unknown }).signedPayload
        : undefined;
    if (typeof signedPayload !== "string") {
      throw new BadRequestException("Invalid Apple notification");
    }
    let notification;
    try {
      notification =
        await this.verifier().verifyAndDecodeNotification(signedPayload);
    } catch {
      throw new ForbiddenException("Invalid provider signature");
    }
    const eventId = notification.notificationUUID;
    if (!eventId) throw new BadRequestException("Invalid Apple notification");
    const signedTransaction = notification.data?.signedTransactionInfo;
    if (!signedTransaction) {
      return { eventId, type: "ignored", occurredAt: new Date() };
    }
    let transaction;
    try {
      transaction =
        await this.verifier().verifyAndDecodeTransaction(signedTransaction);
    } catch {
      throw new ForbiddenException("Invalid provider signature");
    }
    const reversed =
      notification.notificationType === "REFUND" ||
      notification.notificationType === "REVOKE" ||
      transaction.revocationDate !== undefined;
    return {
      eventId,
      type: reversed ? "reversed" : "ignored",
      transactionId: transaction.transactionId,
      providerProductId: transaction.productId,
      currency: transaction.currency,
      occurredAt: new Date(notification.signedDate ?? Date.now()),
    };
  }
}
