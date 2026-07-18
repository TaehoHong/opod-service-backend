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
  bio: string;
  profileImageUrl: string | null;
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((release) => {
    resolve = release;
  });
  return { promise, resolve };
}

function createAuthHarness(
  options: {
    synchronizeRefreshTokenReads?: boolean;
    pauseRefreshSuccessorCreate?: boolean;
    failRefreshTokenCreateAt?: number;
  } = {},
) {
  const users: TestUser[] = [];
  const refreshTokens: Array<{
    tokenHash: string;
    userId: string;
    revokedAt: Date | null;
    createdAt: Date;
  }> = [];
  const withdrawals: Array<{
    id: string;
    userId: string;
    reasonCategory: string | null;
    reasonText: string | null;
    createdAt: Date;
  }> = [];
  const refreshTokenReadWaiters: Array<Array<() => void>> = [[], []];
  const refreshSuccessorCreateStarted = deferred();
  const releaseRefreshSuccessorCreate = deferred();
  const competingSessionLockAttempted = deferred();
  const laterRefreshTokenCreated = deferred();
  const advisoryLockTails = new Map<string, Promise<void>>();
  let synchronizedRefreshTokenReads = 0;
  let refreshTokenCreateCount = 0;
  let sessionLockAttempts = 0;

  const synchronizeRefreshTokenRead = async () => {
    if (
      !options.synchronizeRefreshTokenReads ||
      synchronizedRefreshTokenReads >= 4
    ) {
      return;
    }

    const waiters =
      refreshTokenReadWaiters[Math.floor(synchronizedRefreshTokenReads / 2)];
    synchronizedRefreshTokenReads += 1;
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
      if (waiters.length === 2) {
        waiters.splice(0).forEach((release) => release());
      }
    });
  };

  const grantSignupBonus = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    user: {
      create: jest.fn(async ({ data }) => {
        if (users.some((user) => user.email === data.email)) {
          throw { code: "P2002" };
        }
        const user = {
          id: `user-${users.length + 1}`,
          bio: "",
          profileImageUrl: null,
          ...data,
        };
        users.push(user);
        return user;
      }),
      findUnique: jest.fn(async ({ where }) => {
        const user = users.find(
          (item) => item.email === where.email || item.id === where.id,
        );
        return user ? { ...user } : null;
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
        refreshTokenCreateCount += 1;
        if (
          options.pauseRefreshSuccessorCreate &&
          refreshTokenCreateCount === 2
        ) {
          refreshSuccessorCreateStarted.resolve();
          await releaseRefreshSuccessorCreate.promise;
        }
        if (refreshTokenCreateCount === options.failRefreshTokenCreateAt) {
          throw new Error("refresh token create failed");
        }
        const row = { ...data, revokedAt: null, createdAt: new Date() };
        refreshTokens.push(row);
        if (refreshTokenCreateCount >= 3) {
          laterRefreshTokenCreated.resolve();
        }
        return row;
      }),
      findUnique: jest.fn(async ({ where }) => {
        const row =
          refreshTokens.find((token) => token.tokenHash === where.tokenHash) ??
          null;
        const user = row ? users.find((item) => item.id === row.userId) : null;
        const result = row && user ? { ...row, user: user } : null;
        if (result) {
          await synchronizeRefreshTokenRead();
        }
        return result;
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
            (where.tokenHash === undefined ||
              token.tokenHash === where.tokenHash) &&
            (where.userId === undefined || token.userId === where.userId) &&
            (where.revokedAt === undefined ||
              token.revokedAt === where.revokedAt) &&
            (where.createdAt?.gt === undefined ||
              token.createdAt > where.createdAt.gt),
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
    $executeRaw: jest.fn(async () => 0),
    $transaction: jest.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (
      transaction:
        Promise<unknown>[] | ((client: typeof prisma) => Promise<unknown>),
    ) => {
      if (typeof transaction !== "function") {
        return Promise.all(transaction);
      }

      const releases: Array<() => void> = [];
      let rollbackSnapshot:
        | {
            users: TestUser[];
            refreshTokens: typeof refreshTokens;
          }
        | undefined;
      const transactionClient = {
        ...prisma,
        $executeRaw: jest.fn(
          async (_query: TemplateStringsArray, lockKey: string) => {
            sessionLockAttempts += 1;
            if (sessionLockAttempts >= 2) {
              competingSessionLockAttempted.resolve();
            }

            const previous =
              advisoryLockTails.get(lockKey) ?? Promise.resolve();
            let release!: () => void;
            const held = new Promise<void>((resolve) => {
              release = resolve;
            });
            const current = previous.then(() => held);
            advisoryLockTails.set(lockKey, current);
            await previous;
            rollbackSnapshot = {
              users: users.map((user) => ({ ...user })),
              refreshTokens: refreshTokens.map((token) => ({ ...token })),
            };
            releases.push(() => {
              release();
              if (advisoryLockTails.get(lockKey) === current) {
                advisoryLockTails.delete(lockKey);
              }
            });
            return 0;
          },
        ),
      };

      try {
        return await transaction(transactionClient as unknown as typeof prisma);
      } catch (error) {
        if (rollbackSnapshot) {
          users.splice(
            0,
            users.length,
            ...rollbackSnapshot.users.map((user) => ({ ...user })),
          );
          refreshTokens.splice(
            0,
            refreshTokens.length,
            ...rollbackSnapshot.refreshTokens.map((token) => ({ ...token })),
          );
        }
        throw error;
      } finally {
        releases.reverse().forEach((release) => release());
      }
    },
  );

  const service = new AuthService(
    prisma as unknown as PrismaService,
    {
      grantSignupBonus,
    } as unknown as CreditsService,
  );

  return {
    service,
    grantSignupBonus,
    refreshTokens,
    withdrawals,
    refreshSuccessorCreateStarted: refreshSuccessorCreateStarted.promise,
    releaseRefreshSuccessorCreate: releaseRefreshSuccessorCreate.resolve,
    competingSessionLockAttempted: competingSessionLockAttempted.promise,
    laterRefreshTokenCreated: laterRefreshTokenCreated.promise,
  };
}

function createAuthService() {
  return createAuthHarness().service;
}

describe("AuthService", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = "test-auth-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET;
    delete process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS;
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

  it("rejects missing register and login bodies with client errors", async () => {
    const service = createAuthService();

    await expect(service.register(undefined as never)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.login(undefined as never)).rejects.toThrow(
      BadRequestException,
    );
  });

  it("rejects missing or non-string login passwords as invalid credentials", async () => {
    const service = createAuthService();
    await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    await expect(
      service.login({ email: "reader@example.com" } as never),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.login({
        email: "reader@example.com",
        password: 12345678,
      } as never),
    ).rejects.toThrow(UnauthorizedException);
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

  it("rolls back refresh-token revocation when successor creation fails", async () => {
    const { service, refreshTokens } = createAuthHarness({
      failRefreshTokenCreateAt: 2,
    });
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    await expect(
      service.refresh({ refreshToken: registered.refreshToken }),
    ).rejects.toThrow("refresh token create failed");

    expect(refreshTokens).toHaveLength(1);
    expect(refreshTokens[0].revokedAt).toBeNull();
  });

  it("rejects missing or blank refresh tokens as bad requests", async () => {
    const service = createAuthService();

    await expect(service.refresh(undefined as never)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.refresh({} as never)).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.refresh({ refreshToken: "" })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.revokeRefreshToken(undefined as never),
    ).rejects.toThrow(BadRequestException);
    await expect(service.revokeRefreshToken("   ")).rejects.toThrow(
      BadRequestException,
    );
  });

  it("allows exactly one successor for concurrent refresh requests", async () => {
    const { service, refreshTokens } = createAuthHarness({
      synchronizeRefreshTokenReads: true,
    });
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    const results = await Promise.allSettled([
      service.refresh({ refreshToken: registered.refreshToken }),
      service.refresh({ refreshToken: registered.refreshToken }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejection = results.find((result) => result.status === "rejected");
    expect(
      rejection?.status === "rejected" ? rejection.reason : undefined,
    ).toBeInstanceOf(UnauthorizedException);
    expect(
      refreshTokens.filter((token) => token.revokedAt === null),
    ).toHaveLength(1);
  });

  it("expires refresh tokens after 14 days by default", async () => {
    const { service, refreshTokens } = createAuthHarness();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    refreshTokens[0].createdAt = new Date(
      Date.now() - 14 * 24 * 60 * 60 * 1000,
    );

    await expect(
      service.refresh({ refreshToken: registered.refreshToken }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("uses the configured refresh token TTL", async () => {
    process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS = "60";
    const { service, refreshTokens } = createAuthHarness();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    refreshTokens[0].createdAt = new Date(Date.now() - 60 * 1000);

    await expect(
      service.refresh({ refreshToken: registered.refreshToken }),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("does not rotate a refresh token that expires after its initial read", async () => {
    process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS = "60";
    const { service, refreshTokens } = createAuthHarness();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    const now = Date.now();
    refreshTokens[0].createdAt = new Date(now - 59_000);
    const nowSpy = jest
      .spyOn(Date, "now")
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 2_000);

    try {
      await expect(
        service.refresh({ refreshToken: registered.refreshToken }),
      ).rejects.toThrow(UnauthorizedException);
      expect(refreshTokens).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
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

  it("updates the current user's profile fields", async () => {
    const service = createAuthService() as AuthService & {
      updateCurrentUserFromAuthorization(
        authorization: string,
        input: {
          bio?: string;
          profileImageUrl?: string;
        },
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
        {
          bio: " hello ",
          profileImageUrl: " https://cdn.local/me.png ",
        },
      ),
    ).resolves.toEqual({
      ...registered.user,
      bio: "hello",
      profileImageUrl: "https://cdn.local/me.png",
    });
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

  it("does not issue a login session after the verified password changes", async () => {
    const { service, refreshTokens } = createAuthHarness();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    const internals = service as unknown as {
      passwordMatches(password: string, user: TestUser): Promise<boolean>;
    };
    const passwordVerified = deferred();
    const releaseLogin = deferred();
    const originalPasswordMatches = internals.passwordMatches.bind(service);
    let pausedLogin = false;
    jest
      .spyOn(internals, "passwordMatches")
      .mockImplementation(async (password, user) => {
        const matches = await originalPasswordMatches(password, user);
        if (matches && !pausedLogin) {
          pausedLogin = true;
          passwordVerified.resolve();
          await releaseLogin.promise;
        }
        return matches;
      });

    const staleLogin = service.login({
      email: "reader@example.com",
      password: "password123",
    });
    await passwordVerified.promise;
    const changed = await service.changePasswordFromAuthorization(
      `Bearer ${registered.accessToken}`,
      { currentPassword: "password123", newPassword: "password456" },
    );
    releaseLogin.resolve();

    await expect(staleLogin).rejects.toThrow(UnauthorizedException);
    expect(
      refreshTokens.filter((token) => token.revokedAt === null),
    ).toHaveLength(1);
    await expect(
      service.refresh({ refreshToken: changed.refreshToken }),
    ).resolves.toMatchObject({ user: registered.user });
  });

  it("allows only one concurrent password change from the same old password", async () => {
    const { service, refreshTokens } = createAuthHarness();
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });
    const authorization = `Bearer ${registered.accessToken}`;
    const internals = service as unknown as {
      passwordMatches(password: string, user: TestUser): Promise<boolean>;
    };
    const bothPasswordsVerified = deferred();
    const releaseChanges = deferred();
    const originalPasswordMatches = internals.passwordMatches.bind(service);
    let verifiedCount = 0;
    jest
      .spyOn(internals, "passwordMatches")
      .mockImplementation(async (password, user) => {
        const matches = await originalPasswordMatches(password, user);
        if (matches && verifiedCount < 2) {
          verifiedCount += 1;
          if (verifiedCount === 2) {
            bothPasswordsVerified.resolve();
          }
          await releaseChanges.promise;
        }
        return matches;
      });

    const changes = [
      service.changePasswordFromAuthorization(authorization, {
        currentPassword: "password123",
        newPassword: "password456",
      }),
      service.changePasswordFromAuthorization(authorization, {
        currentPassword: "password123",
        newPassword: "password789",
      }),
    ];
    await bothPasswordsVerified.promise;
    releaseChanges.resolve();
    const results = await Promise.allSettled(changes);

    expect(results.map((result) => result.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    const rejection = results.find((result) => result.status === "rejected");
    expect(
      rejection?.status === "rejected" ? rejection.reason : undefined,
    ).toMatchObject({ message: "Current password is incorrect" });
    expect(
      refreshTokens.filter((token) => token.revokedAt === null),
    ).toHaveLength(1);
  });

  it("does not leave a refresh successor active across a password change", async () => {
    const {
      service,
      refreshTokens,
      refreshSuccessorCreateStarted,
      releaseRefreshSuccessorCreate,
      competingSessionLockAttempted,
      laterRefreshTokenCreated,
    } = createAuthHarness({ pauseRefreshSuccessorCreate: true });
    const registered = await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader",
    });

    const refreshPromise = service.refresh({
      refreshToken: registered.refreshToken,
    });
    await refreshSuccessorCreateStarted;

    const passwordChangePromise = service.changePasswordFromAuthorization(
      `Bearer ${registered.accessToken}`,
      { currentPassword: "password123", newPassword: "password456" },
    );
    await Promise.race([
      competingSessionLockAttempted,
      laterRefreshTokenCreated,
    ]);
    releaseRefreshSuccessorCreate();

    const [refreshed, changed] = await Promise.all([
      refreshPromise,
      passwordChangePromise,
    ]);

    expect(
      refreshTokens.filter((token) => token.revokedAt === null),
    ).toHaveLength(1);
    await expect(
      service.refresh({ refreshToken: refreshed.refreshToken }),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      service.refresh({ refreshToken: changed.refreshToken }),
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

  it("grants the signup bonus when re-registering after withdrawal", async () => {
    const { service, grantSignupBonus } = createAuthHarness();

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

    await service.register({
      email: "reader@example.com",
      password: "password123",
      displayName: "Reader Again",
    });
    expect(grantSignupBonus).toHaveBeenCalledTimes(2);
  });
});
