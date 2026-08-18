import { Polar } from "@polar-sh/sdk";
import { Webhook } from "standardwebhooks";
import { PolarPaymentProvider } from "./polar-payment.provider";

jest.mock("@polar-sh/sdk");

describe("PolarPaymentProvider", () => {
  const secret = "polar-webhook-test-secret";

  afterEach(() => {
    delete process.env.POLAR_ACCESS_TOKEN;
    delete process.env.POLAR_SANDBOX_API_KEY;
    delete process.env.POLAR_SERVER;
    delete process.env.POLAR_WEBHOOK_SECRET;
    jest.clearAllMocks();
  });

  function signedEvent(data: Record<string, unknown>, type = "order.paid") {
    process.env.POLAR_WEBHOOK_SECRET = secret;
    const body = Buffer.from(
      JSON.stringify({
        type,
        timestamp: "2026-08-13T00:00:00.000Z",
        data,
      }),
    );
    const webhookId = "polar-event-1";
    const timestamp = new Date();
    const webhook = new Webhook(Buffer.from(secret).toString("base64"));
    return {
      body,
      headers: {
        "webhook-id": webhookId,
        "webhook-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
        "webhook-signature": webhook.sign(
          webhookId,
          timestamp,
          body.toString("utf8"),
        ),
      },
    };
  }

  it("normalizes signed Polar order amounts and currency", async () => {
    const provider = new PolarPaymentProvider();

    await expect(
      provider.verifyEvent(
        signedEvent({
          id: "polar-order-1",
          product_id: "polar-product-1",
          net_amount: 4900,
          tax_amount: 490,
          total_amount: 5390,
          currency: "krw",
          metadata: { purchase_id: "purchase-1" },
        }),
      ),
    ).resolves.toMatchObject({
      eventId: "polar-event-1",
      type: "paid",
      purchaseId: "purchase-1",
      transactionId: "polar-order-1",
      providerProductId: "polar-product-1",
      netAmount: 4900,
      taxAmount: 490,
      amount: 5390,
      currency: "KRW",
    });
  });

  it("pins checkout creation to the mapped currency", async () => {
    process.env.POLAR_ACCESS_TOKEN = "polar-test-token";
    const create = jest.fn().mockResolvedValue({
      id: "polar-checkout-1",
      url: "https://sandbox.polar.sh/checkout/1",
    });
    jest
      .mocked(Polar)
      .mockImplementation(() => ({ checkouts: { create } }) as never);
    const provider = new PolarPaymentProvider();

    await provider.createCheckout({
      purchaseId: "purchase-1",
      userId: "user-1",
      providerProductId: "polar-product-1",
      currency: "KRW",
      customerIpAddress: "203.0.113.10",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: "krw",
        customerIpAddress: "203.0.113.10",
      }),
    );
  });

  it("uses the sandbox credential only for the sandbox server", async () => {
    process.env.POLAR_SERVER = "sandbox";
    process.env.POLAR_ACCESS_TOKEN = "production-token";
    process.env.POLAR_SANDBOX_API_KEY = "sandbox-token";
    const create = jest.fn().mockResolvedValue({
      id: "polar-checkout-1",
      url: "https://sandbox.polar.sh/checkout/1",
    });
    jest
      .mocked(Polar)
      .mockImplementation(() => ({ checkouts: { create } }) as never);
    const provider = new PolarPaymentProvider();

    await provider.createCheckout({
      purchaseId: "purchase-1",
      userId: "user-1",
      providerProductId: "polar-product-1",
      currency: "KRW",
    });

    expect(Polar).toHaveBeenCalledWith({
      accessToken: "sandbox-token",
      server: "sandbox",
    });
  });

  it("rejects a Polar paid event with a missing tax amount", async () => {
    const provider = new PolarPaymentProvider();

    await expect(
      provider.verifyEvent(
        signedEvent({
          id: "polar-order-1",
          product_id: "polar-product-1",
          net_amount: 4900,
          total_amount: 5400,
          currency: "krw",
          metadata: { purchase_id: "purchase-1" },
        }),
      ),
    ).rejects.toThrow("Invalid provider event");
  });

  it("normalizes a signed cumulative Polar partial refund", async () => {
    const provider = new PolarPaymentProvider();

    await expect(
      provider.verifyEvent(
        signedEvent(
          {
            id: "polar-order-1",
            status: "partially_refunded",
            net_amount: 4900,
            tax_amount: 490,
            total_amount: 5390,
            refunded_amount: 2450,
            refunded_tax_amount: 245,
            currency: "krw",
          },
          "order.refunded",
        ),
      ),
    ).resolves.toMatchObject({
      eventId: "polar-event-1",
      type: "refunded",
      transactionId: "polar-order-1",
      netAmount: 4900,
      taxAmount: 490,
      amount: 2450,
      refundedAmount: 2450,
      refundedTaxAmount: 245,
      currency: "KRW",
    });
  });
});
