import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";
import { registerHuman } from "./human-auth";

function kstToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function previousMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

describe("check-in", () => {
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

  afterAll(() => app.close());

  it("automatically awards once and exposes consistent monthly status", async () => {
    const human = await registerHuman(app);
    const today = kstToday();
    const month = today.slice(0, 7);

    await request(app.getHttpServer()).get("/check-in").expect(401);

    const before = await request(app.getHttpServer())
      .get("/check-in")
      .set(human.authHeaders)
      .expect(200);
    expect(before.body).toMatchObject({
      today,
      month,
      checkedInToday: false,
      checkedInDates: [],
      monthCheckInCount: 0,
      dailyCredits: 10,
      milestones: [
        { count: 7, bonusCredits: 20, achieved: false },
        { count: 14, bonusCredits: 30, achieved: false },
        { count: 30, bonusCredits: 50, achieved: false },
      ],
    });

    const created = await request(app.getHttpServer())
      .post("/check-in")
      .set(human.authHeaders)
      .expect(201);
    expect(created.body).toMatchObject({
      checkInDate: today,
      creditsGranted: 10,
      milestoneBonus: 0,
      monthCheckInCount: 1,
    });

    await request(app.getHttpServer())
      .post("/check-in")
      .set(human.authHeaders)
      .expect(409);

    const after = await request(app.getHttpServer())
      .get(`/check-in?month=${month}`)
      .set(human.authHeaders)
      .expect(200);
    expect(after.body).toMatchObject({
      checkedInToday: true,
      checkedInDates: [today],
      monthCheckInCount: 1,
    });

    const balance = await request(app.getHttpServer())
      .get("/credits/balance")
      .set(human.authHeaders)
      .expect(200);
    expect(balance.body.balance).toBe(110);
  });

  it("returns past-month history and rejects invalid or future months", async () => {
    const human = await registerHuman(app);
    const month = previousMonth(kstToday().slice(0, 7));
    const checkedInDates = Array.from(
      { length: 7 },
      (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`,
    );
    await prisma.creditCheckIn.createMany({
      data: checkedInDates.map((checkInDate) => ({
        userId: human.user.id,
        checkInDate,
      })),
    });

    const response = await request(app.getHttpServer())
      .get(`/check-in?month=${month}`)
      .set(human.authHeaders)
      .expect(200);
    expect(response.body).toMatchObject({
      month,
      checkedInDates,
      monthCheckInCount: 7,
      milestones: [
        { count: 7, bonusCredits: 20, achieved: true },
        { count: 14, bonusCredits: 30, achieved: false },
        { count: 30, bonusCredits: 50, achieved: false },
      ],
    });

    await request(app.getHttpServer())
      .get("/check-in?month=2026-13")
      .set(human.authHeaders)
      .expect(400);
    await request(app.getHttpServer())
      .get("/check-in?month=9999-12")
      .set(human.authHeaders)
      .expect(400);
  });
});
