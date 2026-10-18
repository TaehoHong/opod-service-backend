import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Polar } from "@polar-sh/sdk";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { Webhook } from "standardwebhooks";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { DatabaseService } from "../src/core/database/database.service";
import { adminSettings } from "../src/core/database/schema";
import { TestDatabase } from "./test-database";
import { registerHuman } from "./human-auth";

jest.mock("@polar-sh/sdk");

describe("Polar payment environment isolation", () => {
  let app: INestApplication;
  let database: DatabaseService;
  let db: TestDatabase;
  let originalProvider: string | undefined;
  const productCode = `polar-environment-${randomUUID()}`;
  const secret = "polar-environment-webhook-secret";
  const originalEnvironment = {
    POLAR_SERVER: process.env.POLAR_SERVER,
    POLAR_ACCESS_TOKEN: process.env.POLAR_ACCESS_TOKEN,
    POLAR_SANDBOX_API_KEY: process.env.POLAR_SANDBOX_API_KEY,
    POLAR_WEBHOOK_SECRET: process.env.POLAR_WEBHOOK_SECRET,
  };
  const checkoutList = jest.fn();
  const checkoutCreate = jest.fn();
  const checkoutGet = jest.fn();
  const orderList = jest.fn();
  const refundCreate = jest.fn();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    database = app.get(DatabaseService);
    db = new TestDatabase(database);
    const [setting] = await database.client
      .select()
      .from(adminSettings)
      .where(eq(adminSettings.key, "payments.webProvider"));
    originalProvider = setting?.value;
    await database.client
      .insert(adminSettings)
      .values({ key: "payments.webProvider", value: "polar" })
      .onConflictDoUpdate({
        target: adminSettings.key,
        set: { value: "polar" },
      });
    const product = await db.creditProduct.create({
      data: {
        code: productCode,
        name: "Environment test credits",
        creditAmount: 500,
      },
    });
    for (const environment of ["sandbox", "production"]) {
      await db.paymentProductMapping.create({
        data: {
          creditProductId: product.id,
          channel: "web",
          provider: "polar",
          environment,
          providerProductId: `${productCode}-${environment}`,
          priceAmount: 4900,
          currency: "KRW",
        },
      });
    }
  });

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.POLAR_SERVER = "sandbox";
    process.env.POLAR_SANDBOX_API_KEY = "test-sandbox-token";
    process.env.POLAR_ACCESS_TOKEN = "test-production-token";
    process.env.POLAR_WEBHOOK_SECRET = secret;
    checkoutList.mockResolvedValue({ result: { items: [] } });
    checkoutCreate.mockResolvedValue({
      id: randomUUID(),
      url: "https://sandbox.polar.sh/checkout/test",
    });
    checkoutGet.mockResolvedValue({ status: "open" });
    refundCreate.mockResolvedValue({ id: randomUUID(), status: "succeeded" });
    jest.mocked(Polar).mockImplementation(
      () =>
        ({
          checkouts: {
            list: checkoutList,
            create: checkoutCreate,
            get: checkoutGet,
          },
          orders: { list: orderList },
          refunds: { create: refundCreate },
        }) as never,
    );
  });

  afterAll(async () => {
    if (originalProvider === undefined) {
      await database.client
        .delete(adminSettings)
        .where(eq(adminSettings.key, "payments.webProvider"));
    } else {
      await database.client
        .update(adminSettings)
        .set({ value: originalProvider })
        .where(eq(adminSettings.key, "payments.webProvider"));
    }
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await app.close();
  });

  async function checkout() {
    const human = await registerHuman(app);
    const idempotencyKey = randomUUID();
    const response = await request(app.getHttpServer())
      .post("/purchases/checkouts")
      .set(human.authHeaders)
      .set("Idempotency-Key", idempotencyKey)
      .send({ productId: productCode })
      .expect(201);
    const payment = await db.payment.findUniqueOrThrow({
      where: { purchaseId: response.body.id },
    });
    return {
      human,
      idempotencyKey,
      purchaseId: response.body.id as string,
      payment,
    };
  }

  function event(
    purchaseId: string,
    type = "order.paid",
    eventId = randomUUID(),
  ) {
    const body = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      data: {
        id: `order-${purchaseId}`,
        product_id: `${productCode}-sandbox`,
        net_amount: 4900,
        tax_amount: 490,
        total_amount: 5390,
        refunded_amount: 4900,
        refunded_tax_amount: 490,
        currency: "KRW",
        metadata: { purchase_id: purchaseId },
      },
    });
    const timestamp = new Date();
    const webhook = new Webhook(Buffer.from(secret).toString("base64"));
    return request(app.getHttpServer())
      .post("/payments/webhooks/polar")
      .set("Content-Type", "application/json")
      .set("webhook-id", eventId)
      .set(
        "webhook-timestamp",
        Math.floor(timestamp.getTime() / 1000).toString(),
      )
      .set("webhook-signature", webhook.sign(eventId, timestamp, body))
      .send(body);
  }

  it.each(["sandbox", "production"])(
    "persists the %s binding and replays only its own checkout",
    async (environment) => {
      process.env.POLAR_SERVER = environment;
      checkoutCreate.mockResolvedValue({
        id: randomUUID(),
        url: `https://${environment === "sandbox" ? "sandbox." : ""}polar.sh/checkout/test`,
      });
      const fixture = await checkout();
      expect(fixture.payment.providerEnvironment).toBe(environment);
      const replay = await request(app.getHttpServer())
        .post("/purchases/checkouts")
        .set(fixture.human.authHeaders)
        .set("Idempotency-Key", fixture.idempotencyKey)
        .send({ productId: productCode })
        .expect(201);
      expect(replay.body.id).toBe(fixture.purchaseId);
      expect(checkoutCreate).toHaveBeenCalledTimes(1);
      expect(checkoutCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          products: [`${productCode}-${environment}`],
          currency: "krw",
        }),
      );
    },
  );

  it.each([null, "sandbox"])(
    "rejects old checkout URLs and recovery for binding %s after a production switch",
    async (binding) => {
      const fixture = await checkout();
      await db.payment.update({
        where: { id: fixture.payment.id },
        data: { providerEnvironment: binding },
      });
      process.env.POLAR_SERVER = "production";
      jest.clearAllMocks();
      for (const hasCheckout of [true, false]) {
        if (!hasCheckout) {
          await db.payment.update({
            where: { id: fixture.payment.id },
            data: { providerCheckoutId: null, providerCheckoutUrl: null },
          });
        }
        const replay = await request(app.getHttpServer())
          .post("/purchases/checkouts")
          .set(fixture.human.authHeaders)
          .set("Idempotency-Key", fixture.idempotencyKey)
          .send({ productId: productCode })
          .expect(409);
        expect(replay.body.checkoutUrl).toBeUndefined();
        expect(JSON.stringify(replay.body)).not.toContain("sandbox.polar.sh");
      }
      expect(checkoutList).not.toHaveBeenCalled();
      expect(checkoutCreate).not.toHaveBeenCalled();
      const current = await db.payment.findUniqueOrThrow({
        where: { id: fixture.payment.id },
      });
      expect(current.providerEnvironment).toBe(binding);
    },
  );

  it.each([null, "sandbox"])(
    "blocks reconciliation and signed payment settlement for binding %s",
    async (binding) => {
      const fixture = await checkout();
      await db.payment.update({
        where: { id: fixture.payment.id },
        data: { providerEnvironment: binding },
      });
      process.env.POLAR_SERVER = "production";
      await request(app.getHttpServer())
        .get(`/purchases/checkouts/${fixture.payment.providerCheckoutId}`)
        .set(fixture.human.authHeaders)
        .expect(409);
      await event(fixture.purchaseId).expect(409);
      expect(checkoutGet).not.toHaveBeenCalled();
      expect(orderList).not.toHaveBeenCalled();
      await expect(
        db.creditLedger.count({ where: { purchaseId: fixture.purchaseId } }),
      ).resolves.toBe(0);
      await expect(
        db.paymentLedger.count({ where: { paymentId: fixture.payment.id } }),
      ).resolves.toBe(0);
      const current = await db.payment.findUniqueOrThrow({
        where: { id: fixture.payment.id },
      });
      expect(current.status).toBe("pending");
    },
  );

  it("settles a signed same-environment webhook exactly once and refunds once", async () => {
    const fixture = await checkout();
    const eventId = randomUUID();
    await event(fixture.purchaseId, "order.paid", eventId).expect(201);
    await event(fixture.purchaseId, "order.paid", eventId).expect(201);
    await request(app.getHttpServer())
      .get(`/purchases/checkouts/${fixture.payment.providerCheckoutId}`)
      .set(fixture.human.authHeaders)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("completed"));
    await expect(
      db.creditLedger.count({
        where: { externalReference: `credit_purchase:${fixture.purchaseId}` },
      }),
    ).resolves.toBe(1);
    await expect(
      db.paymentLedger.count({
        where: { paymentId: fixture.payment.id, type: "capture" },
      }),
    ).resolves.toBe(1);
    const idempotencyKey = randomUUID();
    for (let index = 0; index < 2; index += 1) {
      await request(app.getHttpServer())
        .post(`/purchases/${fixture.purchaseId}/refunds`)
        .set(fixture.human.authHeaders)
        .send({ idempotencyKey })
        .expect(201)
        .expect(({ body }) => expect(body.status).toBe("completed"));
    }
    expect(refundCreate).toHaveBeenCalledTimes(1);
    await expect(
      db.paymentLedger.count({
        where: { paymentId: fixture.payment.id, type: "refund" },
      }),
    ).resolves.toBe(1);
  });

  it("reconciles a same-environment paid checkout without its webhook", async () => {
    const fixture = await checkout();
    checkoutGet.mockResolvedValue({
      status: "succeeded",
      externalCustomerId: fixture.human.user.id,
      productId: fixture.payment.providerProductId,
      metadata: { purchase_id: fixture.purchaseId },
    });
    orderList.mockResolvedValue({
      result: {
        items: [
          {
            id: `order-${fixture.purchaseId}`,
            status: "paid",
            paid: true,
            checkoutId: fixture.payment.providerCheckoutId,
            productId: fixture.payment.providerProductId,
            metadata: { purchase_id: fixture.purchaseId },
            netAmount: 4900,
            taxAmount: 490,
            totalAmount: 5390,
            currency: "krw",
            createdAt: new Date(),
          },
        ],
      },
    });
    await request(app.getHttpServer())
      .get(`/purchases/checkouts/${fixture.payment.providerCheckoutId}`)
      .set(fixture.human.authHeaders)
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe("completed"));
    await expect(
      db.paymentLedger.count({
        where: { paymentId: fixture.payment.id, type: "capture" },
      }),
    ).resolves.toBe(1);
  });

  it.each([null, "sandbox"])(
    "blocks paid replay, user refunds and signed refund settlement for binding %s",
    async (binding) => {
      const fixture = await checkout();
      const eventId = randomUUID();
      await event(fixture.purchaseId, "order.paid", eventId).expect(201);
      await db.payment.update({
        where: { id: fixture.payment.id },
        data: { providerEnvironment: binding },
      });
      process.env.POLAR_SERVER = "production";
      await event(fixture.purchaseId, "order.paid", eventId).expect(409);
      await event(fixture.purchaseId, "order.paid").expect(409);
      await event(fixture.purchaseId, "order.refunded").expect(409);
      await request(app.getHttpServer())
        .get(`/purchases/checkouts/${fixture.payment.providerCheckoutId}`)
        .set(fixture.human.authHeaders)
        .expect(409);
      await request(app.getHttpServer())
        .get(`/purchases/${fixture.purchaseId}/refund-quote`)
        .set(fixture.human.authHeaders)
        .expect(409);
      await request(app.getHttpServer())
        .post(`/purchases/${fixture.purchaseId}/refunds`)
        .set(fixture.human.authHeaders)
        .send({ idempotencyKey: randomUUID() })
        .expect(409);
      expect(refundCreate).not.toHaveBeenCalled();
      await expect(
        db.creditRefund.count({ where: { purchaseId: fixture.purchaseId } }),
      ).resolves.toBe(0);
      await expect(
        db.creditLedger.count({
          where: { purchaseId: fixture.purchaseId, type: "refund_recovery" },
        }),
      ).resolves.toBe(0);
      await expect(
        db.paymentLedger.count({ where: { paymentId: fixture.payment.id } }),
      ).resolves.toBe(1);
      const current = await db.payment.findUniqueOrThrow({
        where: { id: fixture.payment.id },
      });
      expect(current.status).toBe("paid");
    },
  );

  it.each(["payment_processing", "payment_succeeded", "completed"])(
    "does not replay or finalize an old %s refund after switching environments",
    async (status) => {
      const fixture = await checkout();
      await event(fixture.purchaseId).expect(201);
      const idempotencyKey = randomUUID();
      await db.creditRefund.create({
        data: {
          purchaseId: fixture.purchaseId,
          provider: "polar",
          status,
          idempotencyKey,
          creditAmount: 500,
          lockedAmount: 500,
          recoveryAmount: 500,
          grossAmount: 4900,
          feeAmount: 245,
          refundAmount: 4655,
          currency: "KRW",
        },
      });
      process.env.POLAR_SERVER = "production";
      await request(app.getHttpServer())
        .post(`/purchases/${fixture.purchaseId}/refunds`)
        .set(fixture.human.authHeaders)
        .send({ idempotencyKey })
        .expect(409);
      expect(refundCreate).not.toHaveBeenCalled();
      await expect(
        db.creditLedger.count({
          where: { purchaseId: fixture.purchaseId, type: "refund_recovery" },
        }),
      ).resolves.toBe(0);
      const refund = await db.creditRefund.findFirstOrThrow({
        where: { purchaseId: fixture.purchaseId },
      });
      expect(refund.status).toBe(status);
    },
  );
});
