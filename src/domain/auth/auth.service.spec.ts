import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { CreditsService } from "../credits/credits.service";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "./auth.service";

type TestUser = {
  id: string;
  displayName: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

function createAuthHarness() {
  const users: TestUser[] = [];
  const refreshTokens: Array<{
    tokenHash: string;
    userId: string;
    revokedAt: Date | null;
  }> = [];
  const withdrawals: Array<{
    id: string;
    userId: string;
    emailHash: string;
    reasonCategory: string | null;
    reasonText: string | null;
    createdAt: Date;
  }> = [];

  const grantSignupBonus = jest.fn().mockResolvedValue(undefined);
  const service = new AuthService(
    {
      user: {
        create: jest.fn(async ({ data }) => {
          if (users.some((user) => user.email === data.email)) {
            throw { code: "P2002" };
          }
          const user = {
            id: `user-${users.length + 1}`,
            ...data,
          };
          users.push(user);
          return user;
        }),
        findUnique: jest.fn(async ({ where }) => {
          return (
            users.find(
              (user) => user.email === where.email || user.id === where.id,
            ) ?? null
          );
        }),
        update: jest.fn(async ({ where, data }) => {
          const user = users.find((item) => item.id === where.id);
          if (!user) {
            throw new Error("missing user");
          }
          Object.assign(user, data);
          return user;
        }),
      },
      userRefreshToken: {
        create: jest.fn(async ({ data }) => {
          refreshTokens.push({ ...data, revokedAt: null });
          return { ...data, revokedAt: null };
        }),
        findUnique: jest.fn(async ({ where }) => {
          const row =
            refreshTokens.find(
              (token) => token.tokenHash === where.tokenHash,
            ) ?? null;
          const user = row
            ? users.find((item) => item.id === row.userId)
            : null;
          return row && user ? { ...row, user: user } : null;
        }),
        update: jest.fn(async ({ where, data }) => {
          const row = refreshTokens.find(
            (token) => token.tokenHash === where.tokenHash,
          );
          if (!row) {
            throw new Error("missing refresh token");
          }
          row.revokedAt = data.revokedAt;
          return { tokenHash: row.tokenHash };
        }),
        updateMany: jest.fn(async ({ where, data }) => {
          const rows = refreshTokens.filter(
            (token) =>
              token.userId === where.userId &&
              token.revokedAt === where.revokedAt,
          );
          for (const row of rows) {
            row.revokedAt = data.revokedAt;
          }
          return { count: rows.length };
        }),
        deleteMany: jest.fn(async ({ where }) => {
          const before = refreshTokens.length;
          for (let index = refreshTokens.length - 1; index >= 0; index--) {
            if (refreshTokens[index].userId === where.userId) {
              refreshTokens.splice(index, 1);
            }
          }
          return { count: before - refreshTokens.length };
        }),
      },
      userEvent: {
        create: jest.fn(async ({ data }) => ({ id: "event-1", ...data })),
      },
      userWithdrawal: {
        create: jest.fn(async ({ data }) => {
          const row = {
            id: `withdrawal-${withdrawals.length + 1}`,
            reasonCategory: null,
            reasonText: null,
            ...data,
            createdAt: new Date(),
          };
          withdrawals.push(row);
          return row;
        }),
        findFirst: jest.fn(async ({ where }) => {
          return (
            withdrawals.find(
              (row) =>
                row.emailHash === where.emailHash &&
                row.createdAt >= where.createdAt.gte,
            ) ?? null
          );
        }),
      },
      messageConversation: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      notification: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      userCharacterFollow: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      userHashtagPreference: {
        deleteMany: jest.fn(async () => ({ count: 0 })),
      },
      $transaction: jest.fn(async (operations: Promise<unknown>[]) =>
        Promise.all(operations),
      ),
    } as unknown as PrismaService,
    {
      grantSignupBonus,
    } as unknown as CreditsService,
  );

  return { service, grantSignupBonus, withdrawals };
}

function createAuthService() {
  return createAuthHarness().service;
}

describe("AuthService", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = "test-auth-secret";
    process.env.AUTH_EMAIL_HASH_PEPPER = "test-email-hash-pepper";
  });

  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.AUTH_EMAIL_HASH_PEPPER;
  });

  it("registers and logs in a user with tokens", async () => {
    const service = createAuthService();

    const registered = await service.register({
      email: "Reader@Example.com",
      password: "password123",
      displayName: "Reader",
    });

    expect(registered.user).toMatchObject({
      displayName: "Reader",
      email: "reader@example.com",
    });
    expect(registered.accessToken).toEqual(expect.any(String));
    expect(registered.refreshToken).toEqual(expect.any(String));

    await expect(
      service.login({
        email: "reader@example.com",
        password: "password123",
      }),
    ).resolves.toMatchObject({
      user: registered.user,
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it("rejects duplicate emails and invalid passwords", async () => {
    const service = createAuthService();

    await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    await expect(
      service.register({
        email: "READER@example.com",
        password: "password123",
        displayName: "Other",
      }),
    ).rejects.toThrow(ConflictException);

    await expect(
      service.login({
        email: "reader@example.com",
        password: "wrong-password",
      }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rotates and revokes refresh tokens", async () => {
    const service = createAuthService();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    const refreshed = await service.refresh({
      refreshToken: registered.refreshToken,
    });

    expect(refreshed.refreshToken).not.toBe(registered.refreshToken);
    await expect(
      service.refresh({ refreshToken: registered.refreshToken }),
    ).rejects.toThrow(UnauthorizedException);

    await service.revokeRefreshToken(refreshed.refreshToken);

    await expect(
      service.refresh({ refreshToken: refreshed.refreshToken }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("verifies valid JWT access tokens and rejects bad ones", async () => {
    const service = createAuthService();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    await expect(
      service.userIdFromAuthorization(`Bearer ${registered.accessToken}`),
    ).resolves.toBe(registered.user.id);

    const tampered = `${registered.accessToken.slice(0, -1)}x`;
    await expect(
      service.userIdFromAuthorization(`Bearer ${tampered}`),
    ).rejects.toThrow(UnauthorizedException);

    const expired = service.issueAccessToken(registered.user.id, -1);
    await expect(
      service.userIdFromAuthorization(`Bearer ${expired}`),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("updates the current user's display name", async () => {
    const service = createAuthService() as AuthService & {
      updateCurrentUserFromAuthorization(
        authorization: string,
        input: { displayName: string },
      ): Promise<unknown>;
    };
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    await expect(
      service.updateCurrentUserFromAuthorization(
        `Bearer ${registered.accessToken}`,
        { displayName: " Updated Reader " },
      ),
    ).resolves.toEqual({
      ...registered.user,
      displayName: "Updated Reader",
    });

    await expect(
      service.updateCurrentUserFromAuthorization(
        `Bearer ${registered.accessToken}`,
        { displayName: " " },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it("changes the password, revokes old sessions, and issues new tokens", async () => {
    const service = createAuthService();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    const changed = await service.changePasswordFromAuthorization(
      `Bearer ${registered.accessToken}`,
      { currentPassword: "password123", newPassword: "password456" },
    );

    expect(changed.user).toEqual(registered.user);
    expect(changed.refreshToken).not.toBe(registered.refreshToken);

    await expect(
      service.refresh({ refreshToken: registered.refreshToken }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.refresh({ refreshToken: changed.refreshToken }),
    ).resolves.toMatchObject({ user: registered.user });

    await expect(
      service.login({ email: "reader@example.com", password: "password123" }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.login({ email: "reader@example.com", password: "password456" }),
    ).resolves.toMatchObject({ user: registered.user });
  });

  it("rejects invalid password change inputs", async () => {
    const service = createAuthService();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    const authorization = `Bearer ${registered.accessToken}`;

    await expect(
      service.changePasswordFromAuthorization(authorization, {
        currentPassword: "wrong-password",
        newPassword: "password456",
      }),
    ).rejects.toThrow("Current password is incorrect");

    await expect(
      service.changePasswordFromAuthorization(authorization, {
        currentPassword: "password123",
        newPassword: "short",
      }),
    ).rejects.toThrow("Password must be 8 to 128 characters");

    await expect(
      service.changePasswordFromAuthorization(authorization, {
        currentPassword: "password123",
        newPassword: "x".repeat(129),
      }),
    ).rejects.toThrow("Password must be 8 to 128 characters");

    await expect(
      service.changePasswordFromAuthorization(authorization, {
        currentPassword: "password123",
        newPassword: "password123",
      }),
    ).rejects.toThrow("New password must be different");

    await expect(
      service.register({
        email: "other@example.com",
        password: "x".repeat(129),
        displayName: "Other",
      }),
    ).rejects.toThrow("Password must be 8 to 128 characters");

    await expect(
      service.login({ email: "reader@example.com", password: "password123" }),
    ).resolves.toMatchObject({ user: registered.user });
  });

  it("deletes the account, anonymizes the user, and blocks further auth", async () => {
    const service = createAuthService();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    await expect(
      service.deleteAccountFromAuthorization(
        `Bearer ${registered.accessToken}`,
        { password: "password123", reasonCategory: "low_usage" },
      ),
    ).resolves.toEqual({ deleted: true });

    await expect(
      service.currentUserFromAuthorization(`Bearer ${registered.accessToken}`),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.login({ email: "reader@example.com", password: "password123" }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.refresh({ refreshToken: registered.refreshToken }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("rejects invalid account deletion requests", async () => {
    const service = createAuthService();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    const authorization = `Bearer ${registered.accessToken}`;

    await expect(
      service.deleteAccountFromAuthorization(authorization, {
        password: "wrong-password",
      }),
    ).rejects.toThrow("Password is incorrect");

    await expect(
      service.deleteAccountFromAuthorization(authorization, {
        password: "password123",
        reasonCategory: "unknown-reason",
      }),
    ).rejects.toThrow("reasonCategory is invalid");

    await expect(
      service.deleteAccountFromAuthorization(authorization, {
        password: "password123",
        reasonText: "x".repeat(501),
      }),
    ).rejects.toThrow("reasonText must be at most 500 characters");

    await expect(
      service.login({ email: "reader@example.com", password: "password123" }),
    ).resolves.toMatchObject({ user: registered.user });
  });

  it("blocks the signup bonus for 30 days after withdrawal", async () => {
    const { service, grantSignupBonus, withdrawals } = createAuthHarness();

    const first = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    expect(grantSignupBonus).toHaveBeenCalledTimes(1);

    await service.deleteAccountFromAuthorization(
      `Bearer ${first.accessToken}`,
      { password: "password123" },
    );

    const second = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader Again",
    });
    expect(grantSignupBonus).toHaveBeenCalledTimes(1);

    await service.deleteAccountFromAuthorization(
      `Bearer ${second.accessToken}`,
      { password: "password123" },
    );
    for (const withdrawal of withdrawals) {
      withdrawal.createdAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    }

    await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader Third",
    });
    expect(grantSignupBonus).toHaveBeenCalledTimes(2);
  });
});
