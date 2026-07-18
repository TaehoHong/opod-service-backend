import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/domain/database/prisma.service";

describe("auth", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers, authenticates, refreshes, and revokes a human session", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email,
        password: "password123",
        displayName: "Reader",
      })
      .expect(201);

    expect(registered.body.user).toEqual({
      id: expect.any(String),
      displayName: "Reader",
      bio: "",
      email,
    });
    expect(registered.body.accessToken).toEqual(expect.any(String));
    expect(registered.body.refreshToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .expect(200)
      .expect(registered.body.user);

    const updatedUser = {
      ...registered.body.user,
      displayName: "Updated Reader",
      bio: "Reader bio",
      profileImageUrl: "https://cdn.example.com/readers/me.png",
    };

    await request(app.getHttpServer())
      .patch("/auth/me")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .send({
        displayName: " Updated Reader ",
        bio: " Reader bio ",
        profileImageUrl: " https://cdn.example.com/readers/me.png ",
      })
      .expect(200)
      .expect(updatedUser);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .expect(200)
      .expect(updatedUser);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email,
        password: "password123",
      })
      .expect(201)
      .expect((response) => {
        expect(response.body.user).toEqual(updatedUser);
        expect(response.body.accessToken).toEqual(expect.any(String));
        expect(response.body.refreshToken).toEqual(expect.any(String));
      });

    const refreshed = await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: registered.body.refreshToken })
      .expect(201);

    expect(refreshed.body.user).toEqual(updatedUser);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).not.toBe(registered.body.refreshToken);

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: registered.body.refreshToken })
      .expect(401);

    await request(app.getHttpServer())
      .delete("/auth/session")
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(200)
      .expect({ revoked: true });

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it("allows only one concurrent refresh-token successor", async () => {
    const email = `reader-${randomUUID()}@example.com`;
    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader" })
      .expect(201);

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post("/auth/refresh")
          .send({ refreshToken: registered.body.refreshToken }),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 401,
    ]);
    await expect(
      app.get(PrismaService).userRefreshToken.count({
        where: { userId: registered.body.user.id, revokedAt: null },
      }),
    ).resolves.toBe(1);
  });

  it("changes the password, logs out other devices, and keeps the current one", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader" })
      .expect(201);

    const profile = await request(app.getHttpServer())
      .patch("/auth/me")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .send({
        bio: "Reader bio",
        profileImageUrl: "https://cdn.example.com/readers/password.png",
      })
      .expect(200);

    const otherDevice = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "password123" })
      .expect(201);

    const changed = await request(app.getHttpServer())
      .patch("/auth/password")
      .set("Authorization", `Bearer ${registered.body.accessToken}`)
      .send({ currentPassword: "password123", newPassword: "password456" })
      .expect(200);

    expect(changed.body.user).toEqual(profile.body);
    expect(changed.body.accessToken).toEqual(expect.any(String));
    expect(changed.body.refreshToken).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: registered.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: otherDevice.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: changed.body.refreshToken })
      .expect(201);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "password123" })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "password456" })
      .expect(201);

    const events = await app.get(PrismaService).userEvent.findMany({
      where: {
        userId: registered.body.user.id,
        eventType: "auth.password_changed",
      },
    });
    expect(events).toHaveLength(1);
  });

  it("rejects invalid password change requests", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader" })
      .expect(201);
    const authorization = `Bearer ${registered.body.accessToken}`;

    await request(app.getHttpServer())
      .patch("/auth/password")
      .send({ currentPassword: "password123", newPassword: "password456" })
      .expect(401);

    await request(app.getHttpServer())
      .patch("/auth/password")
      .set("Authorization", authorization)
      .send({ currentPassword: "wrong-password", newPassword: "password456" })
      .expect(400);

    await request(app.getHttpServer())
      .patch("/auth/password")
      .set("Authorization", authorization)
      .send({ currentPassword: "password123", newPassword: "short" })
      .expect(400);

    await request(app.getHttpServer())
      .patch("/auth/password")
      .set("Authorization", authorization)
      .send({ currentPassword: "password123", newPassword: "password123" })
      .expect(400);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "password123" })
      .expect(201);
  });

  it("deletes the account, anonymizes personal data, and keeps ledger rows", async () => {
    const email = `reader-${randomUUID()}@example.com`;
    const prisma = app.get(PrismaService);

    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader" })
      .expect(201);
    const userId = registered.body.user.id as string;
    const authorization = `Bearer ${registered.body.accessToken}`;

    // 삭제 대상 데이터 심기: 캐릭터 팔로우, 대화+메시지, 알림.
    const character = await prisma.character.create({
      data: {
        publicId: `char-${randomUUID()}`,
        displayName: "Mira",
        bio: "test character",
      },
    });
    await prisma.userCharacterFollow.create({
      data: { userId, characterId: character.id },
    });
    await prisma.messageConversation.create({
      data: {
        userId,
        characterId: character.id,
        messages: {
          create: [{ senderType: "user", body: "hello" }],
        },
      },
    });
    await prisma.notification.create({
      data: { userId, type: "system", title: "welcome" },
    });

    await request(app.getHttpServer())
      .delete("/auth/me")
      .set("Authorization", authorization)
      .send({
        password: "password123",
        reasonCategory: "low_usage",
        reasonText: "자주 사용하지 않아요",
      })
      .expect(200)
      .expect({ deleted: true });

    // users 행 익명화 확인.
    const anonymized = await prisma.user.findUnique({ where: { id: userId } });
    expect(anonymized).toMatchObject({
      email: null,
      passwordHash: null,
      passwordSalt: null,
      displayName: "탈퇴한 사용자",
    });
    expect(anonymized?.deletedAt).toEqual(expect.any(Date));

    // 개인 데이터 삭제 확인.
    await expect(
      prisma.userCharacterFollow.count({ where: { userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.messageConversation.count({ where: { userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.notification.count({ where: { userId } }),
    ).resolves.toBe(0);
    await expect(
      prisma.userRefreshToken.count({ where: { userId } }),
    ).resolves.toBe(0);

    // 크레딧 원장(가입 보너스)은 익명 상태로 잔존.
    await expect(
      prisma.creditLedgerEntry.count({ where: { userId } }),
    ).resolves.toBeGreaterThan(0);

    // 탈퇴 사유가 기록된다.
    const withdrawal = await prisma.userWithdrawal.findFirst({
      where: { userId },
    });
    expect(withdrawal).toMatchObject({
      reasonCategory: "low_usage",
      reasonText: "자주 사용하지 않아요",
    });

    // 잔여 액세스 토큰·리프레시 토큰·이메일 로그인 전부 차단.
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", authorization)
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: registered.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: "password123" })
      .expect(401);
  });

  it("grants the signup bonus when re-registering after withdrawal", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    const first = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader" })
      .expect(201);

    await request(app.getHttpServer())
      .get("/credits/balance")
      .set("Authorization", `Bearer ${first.body.accessToken}`)
      .expect(200)
      .expect({ userId: first.body.user.id, balance: 100 });

    await request(app.getHttpServer())
      .delete("/auth/me")
      .set("Authorization", `Bearer ${first.body.accessToken}`)
      .send({ password: "password123" })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader Again" })
      .expect(201);

    expect(second.body.user.id).not.toBe(first.body.user.id);
    await request(app.getHttpServer())
      .get("/credits/balance")
      .set("Authorization", `Bearer ${second.body.accessToken}`)
      .expect(200)
      .expect({ userId: second.body.user.id, balance: 100 });
  });

  it("rejects invalid account deletion requests", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    const registered = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader" })
      .expect(201);
    const authorization = `Bearer ${registered.body.accessToken}`;

    await request(app.getHttpServer())
      .delete("/auth/me")
      .send({ password: "password123" })
      .expect(401);

    await request(app.getHttpServer())
      .delete("/auth/me")
      .set("Authorization", authorization)
      .send({ password: "wrong-password" })
      .expect(400);

    await request(app.getHttpServer())
      .delete("/auth/me")
      .set("Authorization", authorization)
      .send({ password: "password123", reasonCategory: "unknown" })
      .expect(400);

    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", authorization)
      .expect(200);
  });

  it("rejects malformed register and login bodies without server errors", async () => {
    await request(app.getHttpServer())
      .post("/auth/register")
      .expect(400)
      .expect({
        statusCode: 400,
        message: "email is required",
        error: "Bad Request",
      });
    await request(app.getHttpServer()).post("/auth/login").expect(400).expect({
      statusCode: 400,
      message: "email is required",
      error: "Bad Request",
    });

    const email = `reader-${randomUUID()}@example.com`;
    await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Reader" })
      .expect(201);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email })
      .expect(401);
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email, password: 12345678 })
      .expect(401);
  });

  it("rejects missing or empty refresh-token bodies", async () => {
    const requests = [
      () => request(app.getHttpServer()).post("/auth/refresh"),
      () => request(app.getHttpServer()).post("/auth/refresh").send({}),
      () => request(app.getHttpServer()).delete("/auth/session"),
      () => request(app.getHttpServer()).delete("/auth/session").send({}),
    ];

    for (const makeRequest of requests) {
      await makeRequest().expect(400).expect({
        statusCode: 400,
        message: "refreshToken is required",
        error: "Bad Request",
      });
    }
  });

  it("rejects invalid credentials and missing bearer tokens", async () => {
    const email = `reader-${randomUUID()}@example.com`;

    await request(app.getHttpServer())
      .post("/auth/register")
      .send({
        email,
        password: "password123",
        displayName: "Reader",
      })
      .expect(201);

    await request(app.getHttpServer())
      .post("/auth/login")
      .send({
        email,
        password: "wrong-password",
      })
      .expect(401);

    await request(app.getHttpServer()).get("/auth/me").expect(401);
    await request(app.getHttpServer()).patch("/auth/me").expect(401);
    await request(app.getHttpServer())
      .get("/feed")
      .expect(200)
      .expect((response) => {
        expect(Array.isArray(response.body.items)).toBe(true);
      });
    await request(app.getHttpServer())
      .get("/feed")
      .set("Authorization", "Bearer invalid")
      .expect(401);
  });
});
