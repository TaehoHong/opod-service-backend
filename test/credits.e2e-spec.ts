import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { CreditsService } from "../src/domain/credits/credits.service";
import { PrismaService } from "../src/domain/database/prisma.service";
import { registerHuman } from "./human-auth";

describe("credits", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let creditsService: CreditsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    creditsService = app.get(CreditsService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createCharacter() {
    return prisma.character.create({
      data: {
        publicId: `arin-${randomUUID()}`,
        displayName: "Arin",
        bio: "playful",
      },
    });
  }

  it("grants a signup bonus and meters chat replies", async () => {
    const human = await registerHuman(app);
    const character = await createCharacter();

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect({ userId: human.user.id, balance: 100 });

    await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: character.id, body: "hello" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect({ userId: human.user.id, balance: 98 });

    const ledger = await request(app.getHttpServer())
      .get("/credits/ledger")
      .set(human.authHeaders)
      .expect(200);
    expect(ledger.body.items).toEqual([
      expect.objectContaining({
        entryType: "grant",
        amount: 100,
        remainingAmount: 98,
        reason: "signup bonus",
        expiresAt: expect.any(String),
      }),
      expect.objectContaining({
        entryType: "debit",
        amount: 2,
        reason: "chat_reply",
      }),
    ]);

    const reservations = await prisma.creditReservation.findMany({
      where: { userId: human.user.id },
    });
    expect(reservations).toEqual([
      expect.objectContaining({ status: "captured", amount: 2 }),
    ]);
  });

  it("grants daily check-in credits once per day", async () => {
    const human = await registerHuman(app);

    const checkedIn = await request(app.getHttpServer())
      .post("/credits/check-in")
      .set(human.authHeaders)
      .expect(201);
    expect(checkedIn.body).toEqual({
      checkInDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      creditsGranted: 10,
      milestoneBonus: 0,
      monthCheckInCount: 1,
    });

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect({ userId: human.user.id, balance: 110 });

    await request(app.getHttpServer())
      .post("/credits/check-in")
      .set(human.authHeaders)
      .expect(409);
  });

  it("blocks chat with 402 and no side effects when credits run out", async () => {
    const human = await registerHuman(app);
    const character = await createCharacter();

    await request(app.getHttpServer())
      .post("/credits/debits")
      .set(human.authHeaders)
      .send({ amount: 100, reason: "drain for test" })
      .expect(201);

    const blocked = await request(app.getHttpServer())
      .post("/messages")
      .set(human.authHeaders)
      .send({ characterId: character.id, body: "hello" })
      .expect(402);
    expect(blocked.body).toMatchObject({ error: "INSUFFICIENT_CREDITS" });

    await request(app.getHttpServer())
      .get("/messages")
      .query({ characterId: character.id })
      .set(human.authHeaders)
      .expect(200)
      .expect({ items: [] });

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200)
      .expect({ userId: human.user.id, balance: 0 });
  });

  it("creates one grant for concurrent uses of an external reference", async () => {
    const human = await registerHuman(app);
    const externalReference = `concurrent-grant:${randomUUID()}`;

    const grants = await Promise.all(
      Array.from({ length: 2 }, () =>
        creditsService.grantCredits({
          userId: human.user.id,
          amount: 25,
          reason: "concurrency regression",
          externalReference,
        }),
      ),
    );

    expect(new Set(grants.map((grant) => grant.id)).size).toBe(1);
    await expect(
      prisma.creditLedgerEntry.count({ where: { externalReference } }),
    ).resolves.toBe(1);
  });

  it("persists release before rejecting an expired capture", async () => {
    const human = await registerHuman(app);
    const reservation = await creditsService.reserveCredits({
      userId: human.user.id,
      actionType: "chat_reply",
    });
    await prisma.creditReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    await expect(
      creditsService.captureReservation({ reference: reservation.reference }),
    ).rejects.toThrow("Credit reservation expired");
    await expect(
      prisma.creditReservation.findUnique({
        where: { id: reservation.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "released" });
  });

  it("rolls back a paid purchase when its credit grant fails", async () => {
    const human = await registerHuman(app);
    const purchase = await prisma.creditPurchase.create({
      data: {
        userId: human.user.id,
        provider: "local",
        status: "pending",
        creditAmount: 0,
        paidAmount: 9900,
        currency: "KRW",
      },
    });
    const externalReference = `credit_purchase:${purchase.id}`;

    await expect(
      creditsService.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).rejects.toThrow("Credit amount must be a positive integer");
    await expect(
      prisma.creditPurchase.findUnique({
        where: { id: purchase.id },
        select: { status: true },
      }),
    ).resolves.toEqual({ status: "pending" });
    await expect(
      prisma.creditLedgerEntry.count({ where: { externalReference } }),
    ).resolves.toBe(0);
  });

  it("repairs a missing grant when an already-paid webhook is replayed", async () => {
    const human = await registerHuman(app);
    const purchase = await prisma.creditPurchase.create({
      data: {
        userId: human.user.id,
        provider: "local",
        status: "paid",
        creditAmount: 25,
        paidAmount: 1000,
        currency: "KRW",
      },
    });
    const externalReference = `credit_purchase:${purchase.id}`;

    await expect(
      creditsService.handlePaymentWebhook("local", {
        checkoutId: purchase.id,
        status: "paid",
      }),
    ).resolves.toEqual({ received: true });
    await expect(
      prisma.creditLedgerEntry.findFirst({
        where: { externalReference },
        select: { amount: true, remainingAmount: true },
      }),
    ).resolves.toEqual({ amount: 25, remainingAmount: 25 });
  });

  it("keeps capture and release on one reservation terminal state", async () => {
    const human = await registerHuman(app);
    const reservation = await creditsService.reserveCredits({
      userId: human.user.id,
      actionType: "chat_reply",
    });

    await Promise.allSettled([
      creditsService.captureReservation({ reference: reservation.reference }),
      creditsService.releaseReservation({ reference: reservation.reference }),
    ]);

    const stored = await prisma.creditReservation.findUniqueOrThrow({
      where: { id: reservation.id },
      select: { status: true },
    });
    const debitCount = await prisma.creditLedgerEntry.count({
      where: {
        externalReference: `credit_reservation:${reservation.id}`,
      },
    });
    expect(["captured", "released"]).toContain(stored.status);
    expect(debitCount).toBe(stored.status === "captured" ? 1 : 0);
  });

  it("rejects malformed payment webhook checkout IDs with 400", async () => {
    for (const checkoutId of ["bad-id", 123]) {
      await request(app.getHttpServer())
        .post("/credits/payment-webhooks/local")
        .send({ checkoutId, status: "paid" })
        .expect(400);
    }
  });
});
