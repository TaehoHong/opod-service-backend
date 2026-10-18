import { PaymentsService } from "./payments.service";
import { PolarPaymentProvider } from "./polar-payment.provider";
import { LocalPaymentProvider } from "./local-payment.provider";

describe("PaymentsService Polar environment binding", () => {
  const originalServer = process.env.POLAR_SERVER;
  let provider: PolarPaymentProvider;
  let service: PaymentsService;
  const checkout = {
    purchaseId: "purchase-1",
    userId: "user-1",
    providerProductId: "product-1",
    currency: "KRW",
  };

  beforeEach(() => {
    process.env.POLAR_SERVER = "production";
    provider = new PolarPaymentProvider();
    service = new PaymentsService(
      {} as never,
      provider,
      { name: "apple_iap" } as never,
      { name: "google_play" } as never,
      new LocalPaymentProvider(),
    );
  });

  afterEach(() => {
    if (originalServer === undefined) delete process.env.POLAR_SERVER;
    else process.env.POLAR_SERVER = originalServer;
    jest.restoreAllMocks();
  });

  it.each([null, "sandbox", "development"])(
    "rejects binding %s before any provider checkout, reconciliation or refund call",
    async (environment) => {
      const create = jest.spyOn(provider, "createCheckout");
      const find = jest.spyOn(provider, "findCheckout");
      const reconcile = jest.spyOn(provider, "reconcileCheckout");
      const refund = jest.spyOn(provider, "requestRefund");
      await expect(
        service.createCheckout("polar", checkout, environment),
      ).rejects.toThrow(/Polar payment environment/);
      await expect(
        service.findCheckout("polar", checkout, environment),
      ).rejects.toThrow(/Polar payment environment/);
      await expect(
        service.reconcileCheckout(
          "polar",
          { ...checkout, checkoutId: "checkout-1" },
          environment,
        ),
      ).rejects.toThrow(/Polar payment environment/);
      await expect(
        service.requestRefund(
          "polar",
          {
            providerTransactionId: "order-1",
            amount: 4900,
            refundId: "refund-1",
          },
          environment,
        ),
      ).rejects.toThrow(/Polar payment environment/);
      expect(create).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
      expect(reconcile).not.toHaveBeenCalled();
      expect(refund).not.toHaveBeenCalled();
    },
  );

  it("allows a historical local checkout without a Polar server or binding", async () => {
    delete process.env.POLAR_SERVER;
    await expect(
      service.createCheckout("local", checkout, null),
    ).resolves.toEqual({
      checkoutId: "purchase-1",
      checkoutUrl: "https://payments.local/checkout/purchase-1",
    });
  });
});
