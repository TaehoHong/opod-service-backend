import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CreditsService } from "../src/domain/credits/credits.service";
import { PrismaService } from "../src/domain/database/prisma.service";
import { MESSAGE_REPLY_PROVIDER } from "../src/domain/messages/message-reply.provider";
import { registerHuman } from "./human-auth";

describe("credits, purchases and payments", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let credits: CreditsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGE_REPLY_PROVIDER)
      .useValue({ createReply: jest.fn().mockResolvedValue("Test reply") })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    credits = app.get(CreditsService);
  });

  afterAll(() => app.close());

  async function character() {
    return prisma.character.create({
      data: {
        publicId: `arin-${randomUUID()}`,
        displayName: "Arin",
        bio: "playful",
      },
    });
  }

  it("records a captured action in the immutable ledger with its grant source", async () => {
    const human = await registerHuman(app);
    const target = await character();

    await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: target.id, body: "hello" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect({
        userId: human.user.id,
        balance: 98,
        paidBalance: 0,
        freeBalance: 98,
      });

    const usage = await prisma.creditLedger.findFirstOrThrow({
      where: { userId: human.user.id, type: "usage" },
    });
    const sources = await prisma.creditUsage.findMany({
      where: { usageLedgerId: usage.id },
      include: { grantLedger: true },
    });
    expect(sources).toEqual([
      expect.objectContaining({
        amount: 2,
        grantLedger: expect.objectContaining({
          type: "grant",
          creditKind: "free",
          reason: "signup bonus",
        }),
      }),
    ]);
  });

  it("creates a provider-neutral payment and fulfills a paid webhook once", async () => {
    const human = await registerHuman(app);
    const checkout = await request(app.getHttpServer())
      .post("/purchases/checkouts")
      .set(human.authHeaders)
      .set("Idempotency-Key", `checkout-${randomUUID()}`)
      .send({ productId: "credits_500" })
      .expect(201);

    expect(checkout.body).toMatchObject({
      productId: "credits_500",
      status: "pending",
      payment: { provider: "local", status: "pending" },
    });

    for (let index = 0; index < 2; index += 1) {
      await request(app.getHttpServer())
        .post("/payments/webhooks/local")
        .send({ purchaseId: checkout.body.id, status: "paid" })
        .expect(201);
    }

    await expect(
      prisma.creditLedger.count({
        where: { externalReference: `credit_purchase:${checkout.body.id}` },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.paymentLedger.count({
        where: { payment: { purchaseId: checkout.body.id }, type: "capture" },
      }),
    ).resolves.toBe(1);
  });

  it("locks and completes a web refund through the original provider", async () => {
    const human = await registerHuman(app);
    const checkout = await request(app.getHttpServer())
      .post("/purchases/checkouts")
      .set(human.authHeaders)
      .set("Idempotency-Key", `checkout-${randomUUID()}`)
      .send({ productId: "credits_500" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/payments/webhooks/local")
      .send({ purchaseId: checkout.body.id, status: "paid" })
      .expect(201);

    const quote = await request(app.getHttpServer())
      .get(`/purchases/${checkout.body.id}/refund-quote`)
      .set(human.authHeaders)
      .expect(200);
    expect(quote.body).toMatchObject({
      eligible: true,
      refundableCredits: 500,
      grossAmount: 4900,
      feeAmount: 245,
      refundAmount: 4655,
    });

    const refund = await request(app.getHttpServer())
      .post(`/purchases/${checkout.body.id}/refunds`)
      .set(human.authHeaders)
      .send({ idempotencyKey: `refund-${randomUUID()}` })
      .expect(201);
    expect(refund.body).toMatchObject({ status: "completed", debtAmount: 0 });
    await expect(
      prisma.creditLedger.count({
        where: { purchaseId: checkout.body.id, type: "refund_recovery" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.paymentLedger.count({
        where: { payment: { purchaseId: checkout.body.id }, type: "refund" },
      }),
    ).resolves.toBe(1);
  });

  it("recovers an unused purchase promotion before creating paid debt", async () => {
    const human = await registerHuman(app);
    const checkout = await request(app.getHttpServer())
      .post("/purchases/checkouts")
      .set(human.authHeaders)
      .set("Idempotency-Key", `checkout-${randomUUID()}`)
      .send({ productId: "credits_500" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/payments/webhooks/local")
      .send({ purchaseId: checkout.body.id, status: "paid" })
      .expect(201);
    await credits.grantCredits({
      userId: human.user.id,
      amount: 50,
      reason: "purchase promotion",
      creditKind: "free",
      purchaseId: checkout.body.id,
      promotionCode: "WELCOME",
      externalReference: `promotion:${checkout.body.id}`,
    });

    const refund = await request(app.getHttpServer())
      .post(`/purchases/${checkout.body.id}/refunds`)
      .set(human.authHeaders)
      .send({ idempotencyKey: `refund-${randomUUID()}` })
      .expect(201);
    expect(refund.body).toMatchObject({
      status: "completed",
      promotionAmount: 50,
      debtAmount: 0,
    });

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect({
        userId: human.user.id,
        balance: 100,
        paidBalance: 0,
        freeBalance: 100,
      });
  });

  it("includes paid purchase promotions in the refund eligibility ratio", async () => {
    const human = await registerHuman(app);
    const checkout = await request(app.getHttpServer())
      .post("/purchases/checkouts")
      .set(human.authHeaders)
      .set("Idempotency-Key", `checkout-${randomUUID()}`)
      .send({ productId: "credits_500" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/payments/webhooks/local")
      .send({ purchaseId: checkout.body.id, status: "paid" })
      .expect(201);
    await credits.grantCredits({
      userId: human.user.id,
      amount: 100,
      reason: "paid purchase promotion",
      creditKind: "paid",
      purchaseId: checkout.body.id,
      promotionCode: "PAID-BONUS",
      externalReference: `promotion:${checkout.body.id}`,
    });
    await credits.spendCredits({
      userId: human.user.id,
      amount: 400,
      reason: "refund boundary setup",
    });

    const quote = await request(app.getHttpServer())
      .get(`/purchases/${checkout.body.id}/refund-quote`)
      .set(human.authHeaders)
      .expect(200);
    expect(quote.body).toMatchObject({
      originalCredits: 600,
      remainingCredits: 300,
      refundableCredits: 200,
      promotionRecoveryCredits: 100,
      eligible: true,
      grossAmount: 2450,
      feeAmount: 122,
      refundAmount: 2328,
    });
  });

  it("keeps an external grant reference idempotent under concurrency", async () => {
    const human = await registerHuman(app);
    const externalReference = `concurrent:${randomUUID()}`;
    const grants = await Promise.all(
      [0, 1].map(() =>
        credits.grantCredits({
          userId: human.user.id,
          amount: 25,
          reason: "concurrency regression",
          externalReference,
        }),
      ),
    );
    expect(new Set(grants.map((grant) => grant.id)).size).toBe(1);
    await expect(
      prisma.creditLedger.count({ where: { externalReference } }),
    ).resolves.toBe(1);
  });

  it("releases an expired reservation without creating usage", async () => {
    const human = await registerHuman(app);
    const reservation = await credits.reserveCredits({
      userId: human.user.id,
      actionType: "chat_reply",
    });
    await prisma.creditReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      credits.captureReservation({ reference: reservation.reference }),
    ).rejects.toThrow("Credit reservation expired");
    await expect(
      prisma.creditLedger.count({
        where: { externalReference: `credit_reservation:${reservation.id}` },
      }),
    ).resolves.toBe(0);
  });
});
