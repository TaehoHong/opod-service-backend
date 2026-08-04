export type PaymentChannel = "web" | "apple" | "google";

export type CheckoutRequest = {
  purchaseId: string;
  userId: string;
  providerProductId: string;
  successUrl?: string;
  returnUrl?: string;
};

export type CheckoutResult = {
  checkoutId: string;
  checkoutUrl: string;
};

export type VerifiedPurchase = {
  provider: string;
  channel: "apple" | "google";
  transactionId: string;
  transactionKey: string;
  providerProductId: string;
  environment?: string;
  amount?: number;
  currency?: string;
  occurredAt: Date;
  revoked: boolean;
};

export type PaymentEvent = {
  eventId: string;
  type: "paid" | "refunded" | "reversed" | "failed" | "ignored";
  purchaseId?: string;
  transactionId?: string;
  transactionKey?: string;
  providerProductId?: string;
  amount?: number;
  currency?: string;
  occurredAt: Date;
};

export type RefundResult = {
  providerRefundId: string;
  status: "processing" | "succeeded" | "failed" | "canceled";
};

export interface PaymentProvider {
  readonly name: string;
  readonly channel: PaymentChannel;
  findCheckout?(input: CheckoutRequest): Promise<CheckoutResult | undefined>;
  createCheckout?(input: CheckoutRequest): Promise<CheckoutResult>;
  verifyPurchase?(input: {
    proof: string;
    expectedAccountToken: string;
    expectedProductId: string;
  }): Promise<VerifiedPurchase>;
  verifyEvent?(input: {
    body: Buffer;
    headers: Record<string, string>;
  }): Promise<PaymentEvent>;
  requestRefund?(input: {
    providerTransactionId: string;
    amount: number;
    refundId: string;
  }): Promise<RefundResult>;
}
