import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { queryReturning } from "../../../test/drizzle-mock";
import { AuthService } from "./auth.service";

const user = {
  id: "01980000-0000-7000-8000-000000000001",
  displayName: "Reader",
  bio: "",
  profileImageUrl: null,
  email: "reader@example.com",
  passwordHash: null,
  passwordSalt: null,
  adultIdentityHash: null,
  debtIdentityHash: null,
  deletedAt: null,
};

function harness(options: {
  selects?: unknown[][];
  inserts?: unknown[][];
  resolveConsents?: jest.Mock;
}) {
  const selects = [...(options.selects ?? [])];
  const inserts = [...(options.inserts ?? [])];
  const client: Record<string, jest.Mock> = {
    select: jest.fn(() => queryReturning(selects.shift() ?? [])),
    insert: jest.fn(() => queryReturning(inserts.shift() ?? [])),
    update: jest.fn(() => queryReturning([])),
    delete: jest.fn(() => queryReturning([])),
    execute: jest.fn().mockResolvedValue({ rows: [] }),
  };
  const transaction = jest.fn(async (work: (tx: unknown) => unknown) =>
    work(client),
  );
  const grantSignupBonus = jest.fn().mockResolvedValue(undefined);
  const recordConsents = jest.fn().mockResolvedValue(undefined);
  const service = new AuthService(
    { client: { ...client, transaction } } as never,
    { grantSignupBonus, getPaidBalanceWithClient: jest.fn() } as never,
    {
      resolveRegistrationConsents:
        options.resolveConsents ?? jest.fn().mockResolvedValue([]),
      recordConsents,
    } as never,
    [],
  );
  return { service, client, transaction, grantSignupBonus, recordConsents };
}

describe("AuthService", () => {
  beforeEach(() => {
    process.env.AUTH_JWT_SECRET = "test-auth-secret";
  });

  afterEach(() => {
    delete process.env.AUTH_JWT_SECRET;
  });

  it("registers the user and consent evidence in one transaction", async () => {
    const consents = [{ type: "terms_of_service", version: "1", agreed: true }];
    const resolveConsents = jest.fn().mockResolvedValue(consents);
    const { service, transaction, grantSignupBonus, recordConsents } = harness({
      selects: [[]],
      inserts: [[user], []],
      resolveConsents,
    });

    await expect(
      service.register({
        email: "Reader@Example.com",
        password: "password123",
        displayName: "Reader",
      }),
    ).resolves.toMatchObject({
      user: { id: user.id, email: "reader@example.com" },
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(recordConsents).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      consents,
    );
    expect(grantSignupBonus).toHaveBeenCalledWith(user.id);
  });

  it("rejects malformed email and weak passwords", async () => {
    const { service } = harness({});
    await expect(
      service.register({
        email: "invalid",
        password: "password123",
        displayName: "R",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.register({
        email: "reader@example.com",
        password: "short",
        displayName: "R",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts a signed access token only while the user is active", async () => {
    const { service } = harness({ selects: [[user], []] });
    const token = service.issueAccessToken(user.id);
    await expect(
      service.userIdFromAuthorization(`Bearer ${token}`),
    ).resolves.toBe(user.id);
    await expect(
      service.userIdFromAuthorization(`Bearer ${token}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects tampered and expired access tokens", async () => {
    const { service } = harness({});
    const token = service.issueAccessToken(user.id);
    await expect(
      service.userIdFromAuthorization(`Bearer ${token.slice(0, -1)}x`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    const expired = service.issueAccessToken(user.id, -1);
    await expect(
      service.userIdFromAuthorization(`Bearer ${expired}`),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("requires a bearer token", async () => {
    const { service } = harness({});
    await expect(service.userIdFromAuthorization()).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
