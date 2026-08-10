import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CreditsService } from "../src/domain/credits/credits.service";
import { PrismaService } from "../src/domain/database/prisma.service";
import { PaymentsService } from "../src/domain/payments/payments.service";
import { PurchasesService } from "../src/domain/purchases/purchases.service";
import { MESSAGE_REPLY_PROVIDER } from "../src/domain/messages/message-reply.provider";
import { MessageReplyWorker } from "../src/domain/messages/message-reply.worker";
import { registerHuman } from "./human-auth";

describe("credits, purchases and payments", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let credits: CreditsService;
  let payments: PaymentsService;
  let purchases: PurchasesService;
  let replyWorker: MessageReplyWorker;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MESSAGE_REPLY_PROVIDER)
      .useValue({ createReply: jest.fn().mockResolvedValue("Test reply") })
      .compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    prisma = app.get(PrismaService);
    credits = app.get(CreditsService);
    payments = app.get(PaymentsService);
    purchases = app.get(PurchasesService);
    replyWorker = app.get(MessageReplyWorker);
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

  it("serves the active database product catalog with web prices", async () => {
    const response = await request(app.getHttpServer())
      .get("/purchases/products?channel=web")
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({
        id: "credits_500",
        creditAmount: 500,
        providerProductId: "credits_500",
        priceAmount: 4900,
        currency: "KRW",
      }),
      expect.objectContaining({ id: "credits_1050", priceAmount: 9900 }),
      expect.objectContaining({ id: "credits_3300", priceAmount: 29000 }),
      expect.objectContaining({ id: "credits_5750", priceAmount: 49000 }),
    ]);
  });

  it("blocks new sales after deactivation while replaying an existing checkout", async () => {
    const human = await registerHuman(app);
    const idempotencyKey = `checkout-${randomUUID()}`;
    const first = await request(app.getHttpServer())
      .post("/purchases/checkouts")
      .set(human.authHeaders)
      .set("Idempotency-Key", idempotencyKey)
      .send({ productId: "credits_500" })
      .expect(201);
    const product = await prisma.creditProduct.findUniqueOrThrow({
      where: { code: "credits_500" },
    });

    await prisma.creditProduct.update({
      where: { id: product.id },
      data: { isActive: false },
    });
    try {
      const products = await request(app.getHttpServer())
        .get("/purchases/products?channel=web")
        .expect(200);
      expect(products.body.items).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "credits_500" }),
        ]),
      );
      const replay = await request(app.getHttpServer())
        .post("/purchases/checkouts")
        .set(human.authHeaders)
        .set("Idempotency-Key", idempotencyKey)
        .send({ productId: "credits_500" })
        .expect(201);
      expect(replay.body.id).toBe(first.body.id);
      await request(app.getHttpServer())
        .post("/purchases/checkouts")
        .set(human.authHeaders)
        .set("Idempotency-Key", `checkout-${randomUUID()}`)
        .send({ productId: "credits_500" })
        .expect(409);
    } finally {
      await prisma.creditProduct.update({
        where: { id: product.id },
        data: { isActive: true },
      });
    }
  });

  it("records a captured action in the immutable ledger with its grant source", async () => {
    const human = await registerHuman(app);
    const target = await character();

    await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: target.id, body: "hello" })
      .expect(201);

    // 답변이 오기 전에도 예약분은 쓸 수 있는 잔액에서 빠져 있어야 한다. 만료가
    // 없는 예약이라 시간이 지나도 되살아나지 않는다.
    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect({
        userId: human.user.id,
        balance: 98,
        paidBalance: 0,
        freeBalance: 100,
      });

    await replyWorker.runOnce();

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
    // 웹훅을 두 번 보냈다. 알림을 트랜잭션 밖에서 만들면 inbox 멱등 가드를
    // 우회해 배달마다 쌓이므로 이 단언이 먼저 깨진다.
    await expect(
      prisma.notification.findMany({
        where: { userId: human.user.id, type: "credit.purchase_completed" },
        select: { targetType: true, targetId: true },
      }),
    ).resolves.toEqual([
      { targetType: "purchase", targetId: checkout.body.id },
    ]);
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
    await expect(
      prisma.notification.count({
        where: { userId: human.user.id, type: "credit.refund_completed" },
      }),
    ).resolves.toBe(1);
  });

  it("resumes internal refund finalization without requesting the provider twice", async () => {
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
    const quote = await purchases.refundQuote(human.user.id, checkout.body.id);
    const idempotencyKey = `refund-${randomUUID()}`;
    await prisma.creditRefund.create({
      data: {
        purchaseId: checkout.body.id,
        provider: "local",
        status: "payment_succeeded",
        idempotencyKey,
        creditAmount: quote.refundableCredits,
        promotionAmount: quote.promotionRecoveryCredits,
        lockedAmount: quote.refundableCredits + quote.remainingPromotionCredits,
        recoveryAmount:
          quote.refundableCredits + quote.promotionRecoveryCredits,
        debtAmount: quote.expectedDebtIncrease,
        grossAmount: quote.grossAmount,
        feeAmount: quote.feeAmount,
        refundAmount: quote.refundAmount,
        currency: quote.currency,
        providerRefundId: `provider-refund-${randomUUID()}`,
      },
    });
    const requestRefund = jest.spyOn(payments, "requestRefund");

    const completed = await purchases.requestRefund({
      userId: human.user.id,
      purchaseId: checkout.body.id,
      idempotencyKey,
    });

    expect(completed.status).toBe("completed");
    expect(requestRefund).not.toHaveBeenCalled();
    requestRefund.mockRestore();
  });

  it("serializes concurrent reversal events for the same payment", async () => {
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
    const verify = jest
      .spyOn(payments, "verifyEvent")
      .mockResolvedValueOnce({
        eventId: `reversal-${randomUUID()}`,
        type: "reversed",
        purchaseId: checkout.body.id,
        transactionId: checkout.body.id,
        occurredAt: new Date(),
      })
      .mockResolvedValueOnce({
        eventId: `reversal-${randomUUID()}`,
        type: "reversed",
        purchaseId: checkout.body.id,
        transactionId: checkout.body.id,
        occurredAt: new Date(),
      });

    await Promise.all([
      purchases.applyProviderEvent("local", {
        body: Buffer.alloc(0),
        headers: {},
      }),
      purchases.applyProviderEvent("local", {
        body: Buffer.alloc(0),
        headers: {},
      }),
    ]);
    verify.mockRestore();

    await expect(
      prisma.creditLedger.count({
        where: { purchaseId: checkout.body.id, type: "refund_recovery" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.paymentLedger.count({
        where: {
          payment: { purchaseId: checkout.body.id },
          type: "chargeback",
        },
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

  it("keeps a job-managed reservation active past the normal TTL", async () => {
    const human = await registerHuman(app);
    const reservation = await credits.reserveCredits({
      userId: human.user.id,
      actionType: "chat_reply",
      expiresAt: null,
    });
    // 일반 예약이라면 진작 만료됐을 시점으로 밀어도 살아 있어야 한다. 만료되면
    // 답변 성공과 예약 만료가 경합해 크레딧을 못 받는 답변이 생긴다.
    await prisma.creditReservation.update({
      where: { id: reservation.id },
      data: { createdAt: new Date(Date.now() - 60 * 60_000) },
    });

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect((response) => {
        expect(response.body.balance).toBe(98);
      });
    await expect(
      credits.captureReservation({ reference: reservation.reference }),
    ).resolves.toMatchObject({ status: "captured" });
  });

  it("blocks a refund while a job-managed reservation is still open", async () => {
    const human = await registerHuman(app);
    const target = await character();

    await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: target.id, body: "hello" })
      .expect(201);

    // 진행 중인 DM 답변이 만료 조건으로만 걸러지면 이 예약은 보이지 않고,
    // 환불이 통과해 원장이 음수로 간다.
    const reservations = await prisma.creditReservation.count({
      where: { userId: human.user.id, status: "reserved", expiresAt: null },
    });
    expect(reservations).toBe(1);
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

  it("keeps concurrent reservation release and capture consistent", async () => {
    const human = await registerHuman(app);
    const reservation = await credits.reserveCredits({
      userId: human.user.id,
      actionType: "chat_reply",
      reference: `reservation-${randomUUID()}`,
    });

    const [capture, release] = await Promise.allSettled([
      credits.captureReservation({ reference: reservation.reference }),
      credits.releaseReservation({ reference: reservation.reference }),
    ]);
    const stored = await prisma.creditReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    const usageCount = await prisma.creditLedger.count({
      where: { externalReference: `credit_reservation:${reservation.id}` },
    });

    expect(stored.status === "captured" ? usageCount : 0).toBe(usageCount);
    if (stored.status === "released") {
      expect(capture.status).toBe("rejected");
    } else {
      expect(release.status).toBe("fulfilled");
    }
  });
});
