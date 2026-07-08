import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";
import { registerHuman } from "./human-auth";

describe("credits", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
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
});
