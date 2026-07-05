import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { AuthService } from "./auth.service";

type TestUser = {
  id: string;
  displayName: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

function createAuthService() {
  const users: TestUser[] = [];
  const refreshTokens: Array<{
    tokenHash: string;
    userId: string;
    revokedAt: Date | null;
  }> = [];

  return new AuthService({
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
          refreshTokens.find((token) => token.tokenHash === where.tokenHash) ??
          null;
        const user = row ? users.find((item) => item.id === row.userId) : null;
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
    },
  } as unknown as PrismaService);
}

describe("AuthService", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = "test-auth-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET;
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
});
