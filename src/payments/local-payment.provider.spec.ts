import { LocalPaymentProvider } from "./local-payment.provider";

describe("LocalPaymentProvider", () => {
  afterEach(() => delete process.env.NODE_ENV);

  it("normalizes a development paid event", async () => {
    const provider = new LocalPaymentProvider();
    await expect(
      provider.verifyEvent({
        body: Buffer.from(
          JSON.stringify({ purchaseId: "purchase-1", status: "paid" }),
        ),
        headers: {},
      }),
    ).resolves.toMatchObject({
      eventId: "local:purchase-1:paid",
      purchaseId: "purchase-1",
      type: "paid",
    });
  });

  it("cannot be enabled in production", async () => {
    process.env.NODE_ENV = "production";
    await expect(
      new LocalPaymentProvider().createCheckout({ purchaseId: "purchase-1" }),
    ).rejects.toThrow("Local payments are disabled");
  });
});
