import { UnauthorizedException, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { randomUUID } from "node:crypto";
import request from "supertest";
import { AppModule } from "../src/app.module";
import {
  SOCIAL_IDENTITY_PROVIDERS,
  SocialIdentityProvider,
  VerifiedSocialIdentity,
} from "../src/domain/auth/social-identity.provider";
import { PrismaService } from "../src/domain/database/prisma.service";

describe("auth", () => {
  let app: INestApplication;
  const verifySocialIdentity = jest.fn<
    Promise<VerifiedSocialIdentity>,
    [string]
  >();
  const socialIdentityProvider: SocialIdentityProvider = {
    provider: "google",
    verify: verifySocialIdentity,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SOCIAL_IDENTITY_PROVIDERS)
      .useValue([socialIdentityProvider])
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  beforeEach(() => {
    verifySocialIdentity.mockReset();
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
      .expect({
        userId: first.body.user.id,
        balance: 100,
        paidBalance: 0,
        freeBalance: 100,
      });

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
      .expect({
        userId: second.body.user.id,
        balance: 100,
        paidBalance: 0,
        freeBalance: 100,
      });
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

  it("creates a separate Google account and reuses it across OPOD sessions", async () => {
    const email = `shared-${randomUUID()}@example.com`;
    const local = await request(app.getHttpServer())
      .post("/auth/register")
      .send({ email, password: "password123", displayName: "Local Reader" })
      .expect(201);

    verifySocialIdentity.mockResolvedValue({
      providerAccountId: "google-account-1",
      email,
      displayName: "Google Reader",
    });
    const created = await request(app.getHttpServer())
      .post("/auth/social/GOOGLE")
      .send({
        idToken: "google-token-1",
        displayName: "Client Reader",
      })
      .expect(201);

    expect(created.body.user).toEqual({
      id: expect.any(String),
      displayName: "Google Reader",
      bio: "",
      email,
    });
    expect(created.body.user.id).not.toBe(local.body.user.id);
    expect(created.body.accessToken).toEqual(expect.any(String));
    expect(created.body.refreshToken).toEqual(expect.any(String));

    const prisma = app.get(PrismaService);
    await expect(
      prisma.user.findUnique({
        where: { id: created.body.user.id },
        select: { email: true, passwordHash: true, passwordSalt: true },
      }),
    ).resolves.toEqual({
      email: null,
      passwordHash: null,
      passwordSalt: null,
    });
    await expect(
      prisma.userAccount.findMany({
        where: { userId: created.body.user.id },
        select: {
          provider: true,
          providerAccountId: true,
          email: true,
        },
      }),
    ).resolves.toEqual([
      {
        provider: "google",
        providerAccountId: "google-account-1",
        email,
      },
    ]);

    verifySocialIdentity.mockResolvedValue({
      providerAccountId: "google-account-1",
      email: `updated-${email}`,
      displayName: "Changed Provider Name",
    });
    const returning = await request(app.getHttpServer())
      .post("/auth/social/Google")
      .send({
        idToken: "google-token-2",
        displayName: "Changed Client Name",
        consents: [],
      })
      .expect(201);

    expect(returning.body.user).toEqual({
      ...created.body.user,
      email: `updated-${email}`,
    });
    await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${returning.body.accessToken}`)
      .expect(200)
      .expect(returning.body.user);

    const updated = await request(app.getHttpServer())
      .patch("/auth/me")
      .set("Authorization", `Bearer ${returning.body.accessToken}`)
      .send({ displayName: "Social Reader" })
      .expect(200);
    expect(updated.body).toEqual({
      ...returning.body.user,
      displayName: "Social Reader",
    });

    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: returning.body.refreshToken })
      .expect(201)
      .expect((response) => {
        expect(response.body.user).toEqual(updated.body);
      });
    await request(app.getHttpServer())
      .patch("/auth/password")
      .set("Authorization", `Bearer ${returning.body.accessToken}`)
      .send({ currentPassword: "password123", newPassword: "password456" })
      .expect(400)
      .expect({
        statusCode: 400,
        message: "비밀번호 로그인이 설정되지 않은 계정입니다",
        error: "Bad Request",
      });
    await request(app.getHttpServer())
      .get("/credits/balance")
      .set("Authorization", `Bearer ${returning.body.accessToken}`)
      .expect(200)
      .expect({
        userId: created.body.user.id,
        balance: 100,
        paidBalance: 0,
        freeBalance: 100,
      });
  });

  it("serializes concurrent first Google logins into one account", async () => {
    const providerAccountId = `google-${randomUUID()}`;
    verifySocialIdentity.mockResolvedValue({ providerAccountId });

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post("/auth/social/google")
          .send({ idToken: "same-google-token", displayName: " " }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(responses[0].body.user.id).toBe(responses[1].body.user.id);
    expect(responses[0].body.user.displayName).toMatch(/^사용자#[0-9A-F]{6}$/);
    expect(responses[0].body.user.email).toBeNull();

    const prisma = app.get(PrismaService);
    const account = await prisma.userAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: "google",
          providerAccountId,
        },
      },
      select: { userId: true },
    });
    expect(account?.userId).toBe(responses[0].body.user.id);
    await expect(
      prisma.creditLedgerEntry.count({
        where: {
          userId: responses[0].body.user.id,
          externalReference: `signup_bonus:${responses[0].body.user.id}`,
        },
      }),
    ).resolves.toBe(1);
  });

  it("normalizes social login request failures without persisting an account", async () => {
    const prisma = app.get(PrismaService);
    const accountCountBefore = await prisma.userAccount.count();

    await request(app.getHttpServer())
      .post("/auth/social/google")
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .post("/auth/social/github")
      .send({ idToken: "provider-token" })
      .expect(400);

    verifySocialIdentity.mockRejectedValueOnce(
      new UnauthorizedException("유효하지 않은 소셜 로그인 토큰입니다"),
    );
    await request(app.getHttpServer())
      .post("/auth/social/google")
      .send({ idToken: "invalid-google-token" })
      .expect(401)
      .expect({
        statusCode: 401,
        message: "유효하지 않은 소셜 로그인 토큰입니다",
        error: "Unauthorized",
      });
    await expect(prisma.userAccount.count()).resolves.toBe(accountCountBefore);
  });
});
