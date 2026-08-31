import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { and, count, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { ConsentsService } from "../consents/consents.service";
import { CreditsService } from "../credits/credits.service";
import {
  DatabaseService,
  type DatabaseClient,
} from "../database/database.service";
import {
  creditLedger,
  creditPurchases,
  creditRefund,
  messageConversations,
  notifications,
  unsettledCreditDebts,
  userAccounts,
  userCharacterFollows,
  userEvents,
  userHashtagPreferences,
  userRefreshTokens,
  users,
  userWithdrawals,
} from "../database/schema";
import {
  SOCIAL_IDENTITY_PROVIDERS,
  SocialIdentityProvider,
} from "./social-identity.provider";

const scrypt = promisify(scryptCallback);

type PublicAuthUserSource = {
  id: string;
  displayName: string;
  bio: string;
  profileImageUrl: string | null;
  email: string | null;
  userAccounts?: Array<{ email: string | null }>;
};

type AuthUser = PublicAuthUserSource & {
  passwordHash: string | null;
  passwordSalt: string | null;
  adultIdentityHash: string | null;
  debtIdentityHash: string | null;
};

type PublicAuthUser = {
  id: string;
  displayName: string;
  bio: string;
  profileImageUrl?: string;
  email: string | null;
};

type RefreshTokenRow = {
  tokenHash: string;
  userId: string;
  revokedAt: Date | null;
  createdAt: Date;
  user?: {
    id: string;
    displayName: string;
    bio: string;
    profileImageUrl: string | null;
    email: string | null;
    userAccounts?: Array<{ email: string | null }>;
  };
};

type SocialAccountRow = {
  id: string;
  email: string | null;
  user: PublicAuthUserSource & { deletedAt: Date | null };
};

type AuthTokens = {
  user: PublicAuthUser;
  accessToken: string;
  refreshToken: string;
};

type AuthSessionClient = Pick<
  DatabaseClient,
  "select" | "insert" | "update" | "delete" | "execute"
>;

type JwtPayload = {
  sub: string;
  iat: number;
  exp: number;
};

const authUserFields = {
  id: users.id,
  displayName: users.displayName,
  bio: users.bio,
  profileImageUrl: users.profileImageUrl,
  email: users.email,
  passwordHash: users.passwordHash,
  passwordSalt: users.passwordSalt,
  adultIdentityHash: users.adultIdentityHash,
  debtIdentityHash: users.debtIdentityHash,
} as const;

const publicUserFields = {
  id: users.id,
  displayName: users.displayName,
  bio: users.bio,
  profileImageUrl: users.profileImageUrl,
  email: users.email,
} as const;

const withdrawalReasonCategories = [
  "low_usage",
  "credit_cost",
  "content",
  "privacy",
  "etc",
];

const deletedUserDisplayName = "탈퇴한 사용자";

const defaultRefreshTokenTtlSeconds = 14 * 24 * 60 * 60;

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly creditsService: CreditsService,
    private readonly consentsService: ConsentsService,
    @Inject(SOCIAL_IDENTITY_PROVIDERS)
    private readonly socialIdentityProviders: SocialIdentityProvider[],
  ) {}

  async register(
    input:
      | {
          email?: unknown;
          password?: unknown;
          displayName?: unknown;
          consents?: unknown;
        }
      | undefined,
  ): Promise<AuthTokens> {
    const email = this.normalizeEmail(input?.email);
    const displayName = this.requiredString(input?.displayName, "displayName");
    const password = input?.password;
    this.assertPassword(password);

    if (await this.findAuthUserByEmail(email)) {
      throw new ConflictException("Email is already registered");
    }

    const consents = await this.consentsService.resolveRegistrationConsents(
      input?.consents,
    );

    const passwordSalt = randomBytes(16).toString("base64url");
    const passwordHash = await this.hashPassword(password, passwordSalt);

    // 계정과 동의 증빙은 함께 남아야 한다 — 한쪽만 남는 상태를 만들지 않는다.
    const user = await this.database.client.transaction(async (tx) => {
      const created = await this.createAuthUser(
        { email, displayName, passwordHash, passwordSalt },
        tx,
      );
      await this.consentsService.recordConsents(tx, created.id, consents);
      return created;
    });
    await this.creditsService.grantSignupBonus(user.id);

    return this.issueTokens(this.toPublicUser(user));
  }

  async login(
    input: { email?: unknown; password?: unknown } | undefined,
  ): Promise<AuthTokens> {
    const email = this.normalizeEmail(input?.email);
    const password = input?.password;
    const user = await this.findAuthUserByEmail(email);

    if (
      !user ||
      !user.passwordHash ||
      !user.passwordSalt ||
      typeof password !== "string" ||
      !(await this.passwordMatches(password, user))
    ) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.database.client.transaction(async (tx) => {
      await this.lockUserSessions(tx, user.id);
      const [currentUser] = await tx
        .select(authUserFields)
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (
        !currentUser?.email ||
        !currentUser.passwordHash ||
        !currentUser.passwordSalt ||
        currentUser.passwordHash !== user.passwordHash ||
        currentUser.passwordSalt !== user.passwordSalt
      ) {
        throw new UnauthorizedException("Invalid email or password");
      }

      return this.issueTokens(this.toPublicUser(currentUser), tx);
    });
  }

  async socialLogin(
    providerValue: unknown,
    input:
      | {
          idToken?: unknown;
          displayName?: unknown;
          consents?: unknown;
        }
      | undefined,
  ): Promise<AuthTokens> {
    const provider = this.requiredString(
      providerValue,
      "provider",
    ).toLowerCase();
    const identityProvider = this.socialIdentityProviders.find(
      (candidate) => candidate.provider === provider,
    );
    if (!identityProvider) {
      throw new BadRequestException("Social login provider is not supported");
    }

    const idToken = this.requiredString(input?.idToken, "idToken");
    const identity = await identityProvider.verify(idToken);
    const result = await this.database.client.transaction(async (tx) => {
      await this.lockSocialIdentity(tx, provider, identity.providerAccountId);

      const existing = await this.findSocialAccount(
        tx,
        provider,
        identity.providerAccountId,
      );
      if (existing) {
        if (existing.user.deletedAt) {
          throw new UnauthorizedException(
            "유효하지 않은 소셜 로그인 토큰입니다",
          );
        }

        const accountEmail =
          identity.email && identity.email !== existing.email
            ? (
                await tx
                  .update(userAccounts)
                  .set({ email: identity.email })
                  .where(eq(userAccounts.id, existing.id))
                  .returning({ email: userAccounts.email })
              )[0].email
            : existing.email;

        return {
          user: {
            ...existing.user,
            userAccounts: [{ email: accountEmail }],
          },
        };
      }

      const consents = await this.consentsService.resolveRegistrationConsents(
        input?.consents,
      );
      const clientDisplayName =
        typeof input?.displayName === "string"
          ? input.displayName.trim() || undefined
          : undefined;
      const displayName =
        identity.displayName?.trim() ||
        clientDisplayName ||
        this.randomSocialDisplayName();

      const [user] = await tx
        .insert(users)
        .values({ displayName })
        .returning(authUserFields);
      const [account] = await tx
        .insert(userAccounts)
        .values({
          userId: user.id,
          provider,
          providerAccountId: identity.providerAccountId,
          email: identity.email,
        })
        .returning({ email: userAccounts.email });
      await this.consentsService.recordConsents(tx, user.id, consents);

      return {
        user: {
          ...user,
          userAccounts: [{ email: account.email }],
        },
      };
    });

    // The grant is idempotent, so retrying a login repairs a prior request
    // that created the account but failed before the bonus completed.
    await this.creditsService.grantSignupBonus(result.user.id);
    return this.issueTokens(this.toPublicUser(result.user));
  }

  async refresh(
    input: { refreshToken?: unknown } | undefined,
  ): Promise<AuthTokens> {
    const refreshToken = this.requiredString(
      input?.refreshToken,
      "refreshToken",
    );
    const row = await this.findRefreshToken(refreshToken);

    if (
      !row ||
      row.revokedAt ||
      row.createdAt.getTime() + this.refreshTokenTtlSeconds() * 1000 <=
        Date.now()
    ) {
      throw new UnauthorizedException("Refresh token is invalid");
    }

    const user = this.toPublicUserFromRefresh(row);
    return this.database.client.transaction(async (tx) => {
      await this.lockUserSessions(tx, row.userId);
      const cutoff = new Date(
        Date.now() - this.refreshTokenTtlSeconds() * 1000,
      );
      const revoked = await tx
        .update(userRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userRefreshTokens.tokenHash, row.tokenHash),
            eq(userRefreshTokens.userId, row.userId),
            isNull(userRefreshTokens.revokedAt),
            gt(userRefreshTokens.createdAt, cutoff),
          ),
        )
        .returning({ id: userRefreshTokens.id });
      if (revoked.length !== 1) {
        throw new UnauthorizedException("Refresh token is invalid");
      }

      return this.issueTokens(user, tx);
    });
  }

  async revokeRefreshToken(refreshToken: unknown): Promise<{ revoked: true }> {
    const tokenHash = this.hashToken(
      this.requiredString(refreshToken, "refreshToken"),
    );
    const result = await this.database.client
      .update(userRefreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userRefreshTokens.tokenHash, tokenHash),
          isNull(userRefreshTokens.revokedAt),
        ),
      )
      .returning({ id: userRefreshTokens.id });

    if (result.length !== 1) {
      throw new UnauthorizedException("Refresh token is invalid");
    }
    return { revoked: true };
  }

  issueAccessToken(userId: string, expiresInSeconds = 15 * 60): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: userId,
      iat: now,
      exp: now + expiresInSeconds,
    };
    return this.signJwt(payload);
  }

  async userIdFromAuthorization(authorization?: string): Promise<string> {
    const token = this.bearerToken(authorization);
    const payload = this.verifyAccessToken(token);
    if (!(await this.findPublicUserById(payload.sub))) {
      throw new UnauthorizedException("Access token is invalid");
    }
    return payload.sub;
  }

  async optionalUserIdFromAuthorization(
    authorization?: string,
  ): Promise<string | undefined> {
    return authorization?.trim()
      ? this.userIdFromAuthorization(authorization)
      : undefined;
  }

  async currentUserFromAuthorization(
    authorization?: string,
  ): Promise<PublicAuthUser> {
    const userId = await this.userIdFromAuthorization(authorization);
    const user = await this.findPublicUserById(userId);
    if (!user) {
      throw new UnauthorizedException("Access token is invalid");
    }
    return user;
  }

  async changePasswordFromAuthorization(
    authorization: string | undefined,
    input: { currentPassword?: unknown; newPassword?: unknown } | undefined,
  ): Promise<AuthTokens> {
    const userId = await this.userIdFromAuthorization(authorization);

    const [user] = await this.database.client
      .select(authUserFields)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) {
      throw new UnauthorizedException("Access token is invalid");
    }
    if (!user.email || !user.passwordHash || !user.passwordSalt) {
      throw new BadRequestException(
        "비밀번호 로그인이 설정되지 않은 계정입니다",
      );
    }

    const currentPassword = input?.currentPassword;
    if (typeof currentPassword !== "string" || !currentPassword) {
      throw new BadRequestException("currentPassword is required");
    }
    this.assertPassword(input?.newPassword);
    const newPassword = input?.newPassword as string;
    if (newPassword === currentPassword) {
      throw new BadRequestException("New password must be different");
    }

    if (!(await this.passwordMatches(currentPassword, user))) {
      throw new BadRequestException("Current password is incorrect");
    }

    const passwordSalt = randomBytes(16).toString("base64url");
    const passwordHash = await this.hashPassword(newPassword, passwordSalt);

    return this.database.client.transaction(async (tx) => {
      await this.lockUserSessions(tx, userId);
      const [currentUser] = await tx
        .select(authUserFields)
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (
        !currentUser?.email ||
        !currentUser.passwordHash ||
        !currentUser.passwordSalt
      ) {
        throw new BadRequestException(
          "비밀번호 로그인이 설정되지 않은 계정입니다",
        );
      }
      if (
        currentUser.passwordHash !== user.passwordHash ||
        currentUser.passwordSalt !== user.passwordSalt
      ) {
        throw new BadRequestException("Current password is incorrect");
      }
      await tx
        .update(users)
        .set({ passwordHash, passwordSalt })
        .where(eq(users.id, userId));
      await tx
        .update(userRefreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(userRefreshTokens.userId, userId),
            isNull(userRefreshTokens.revokedAt),
          ),
        );
      await tx.insert(userEvents).values({
          userId,
          eventType: "auth.password_changed",
          targetType: "user",
          targetId: userId,
      });

      return this.issueTokens(this.toPublicUser(currentUser), tx);
    });
  }

  async deleteAccountFromAuthorization(
    authorization: string | undefined,
    input:
      | { password?: unknown; reasonCategory?: unknown; reasonText?: unknown }
      | undefined,
  ): Promise<{ deleted: true }> {
    const userId = await this.userIdFromAuthorization(authorization);

    const password = input?.password;
    if (typeof password !== "string" || !password) {
      throw new BadRequestException("password is required");
    }
    const reasonCategory = this.optionalWithdrawalReason(input?.reasonCategory);
    const reasonText = this.optionalReasonText(input?.reasonText);

    const [user] = await this.database.client
      .select(authUserFields)
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user?.email) {
      throw new UnauthorizedException("Access token is invalid");
    }
    if (
      !user.passwordHash ||
      !user.passwordSalt ||
      !(await this.passwordMatches(password, user))
    ) {
      throw new BadRequestException("Password is incorrect");
    }

    await this.database.client.transaction(async (tx) => {
      const identityHash =
        user.adultIdentityHash ?? user.debtIdentityHash ?? null;
      if (identityHash) {
        await this.lockAdultIdentity(tx, identityHash);
      }
      await this.lockUser(tx, userId);

      const [paidBalance, activeRefundRows, pendingPurchaseRows] = await Promise.all([
        this.creditsService.getPaidBalanceWithClient(tx, userId),
        tx
          .select({ value: count() })
          .from(creditRefund)
          .innerJoin(
            creditPurchases,
            eq(creditRefund.purchaseId, creditPurchases.id),
          )
          .where(
            and(
              eq(creditPurchases.userId, userId),
              inArray(creditRefund.status, [
                "reserved",
                "payment_processing",
                "payment_succeeded",
              ]),
            ),
          ),
        tx
          .select({ value: count() })
          .from(creditPurchases)
          .where(
            and(
              eq(creditPurchases.userId, userId),
              inArray(creditPurchases.status, ["pending", "payment_processing"]),
            ),
          ),
      ]);
      const activeRefunds = activeRefundRows[0]?.value ?? 0;
      const pendingPurchases = pendingPurchaseRows[0]?.value ?? 0;
      if (paidBalance > 0 || activeRefunds > 0 || pendingPurchases > 0) {
        throw new ConflictException(
          "Paid credits and pending payments must be settled before withdrawal",
        );
      }
      const paidDebt = Math.max(0, -paidBalance);
      if (paidDebt > 0 && identityHash) {
        await tx
          .insert(unsettledCreditDebts)
          .values({ identityHash, paidDebt })
          .onConflictDoUpdate({
            target: unsettledCreditDebts.identityHash,
            set: { paidDebt: sql`${unsettledCreditDebts.paidDebt} + ${paidDebt}` },
          });
      }

      // users 행은 결제·분쟁 기록의 익명 FK 대상으로 유지한다.
      await tx
        .update(users)
        .set({
            email: null,
            passwordHash: null,
            passwordSalt: null,
            displayName: deletedUserDisplayName,
            bio: "",
            profileImageUrl: null,
            adultVerifiedAt: null,
            adultIdentityHash: null,
            debtIdentityHash: null,
            deletedAt: new Date(),
        })
        .where(eq(users.id, userId));
      await Promise.all([
        tx.delete(userRefreshTokens).where(eq(userRefreshTokens.userId, userId)),
        // 메시지는 conversation FK cascade로 함께 삭제된다.
        tx.delete(messageConversations).where(eq(messageConversations.userId, userId)),
        tx.delete(notifications).where(eq(notifications.userId, userId)),
        tx.delete(userCharacterFollows).where(eq(userCharacterFollows.userId, userId)),
        tx.delete(userHashtagPreferences).where(eq(userHashtagPreferences.userId, userId)),
        tx.insert(userWithdrawals).values({ userId, reasonCategory, reasonText }),
      ]);
    });

    return { deleted: true };
  }

  async verifyAdultIdentityFromAuthorization(
    authorization: string | undefined,
    input: { providerIdentityKey?: unknown } | undefined,
  ): Promise<{ adultVerified: true; debtApplied: number; paidDebt: number }> {
    if (process.env.NODE_ENV === "production") {
      throw new ServiceUnavailableException(
        "Adult verification provider is not configured",
      );
    }
    const userId = await this.userIdFromAuthorization(authorization);
    const providerIdentityKey = this.requiredString(
      input?.providerIdentityKey,
      "providerIdentityKey",
    );
    return this.applyVerifiedAdultIdentity(userId, providerIdentityKey);
  }

  async applyVerifiedAdultIdentity(
    userId: string,
    providerIdentityKey: string,
  ): Promise<{ adultVerified: true; debtApplied: number; paidDebt: number }> {
    const identityHash = this.hashAdultIdentity(providerIdentityKey);
    return this.database.client.transaction(async (tx) => {
      await this.lockAdultIdentity(tx, identityHash);
      await this.lockUser(tx, userId);

      const [user] = await tx
        .select({ id: users.id, deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      if (!user || user.deletedAt) {
        throw new UnauthorizedException("Access token is invalid");
      }
      const [linked] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.adultIdentityHash, identityHash),
            ne(users.id, userId),
            isNull(users.deletedAt),
          ),
        )
        .limit(1);
      if (linked) {
        throw new ConflictException("Adult identity is already linked");
      }

      const [unsettled, currentPaidBalance] = await Promise.all([
        tx
          .select()
          .from(unsettledCreditDebts)
          .where(eq(unsettledCreditDebts.identityHash, identityHash))
          .limit(1)
          .then((rows) => rows[0]),
        this.creditsService.getPaidBalanceWithClient(tx, userId),
      ]);
      const debtApplied = unsettled?.paidDebt ?? 0;
      const paidDebt = Math.max(0, -currentPaidBalance) + debtApplied;
      if (debtApplied > 0) {
        await tx.insert(creditLedger).values({
            userId,
            type: "adjustment",
            creditKind: "paid",
            amount: -debtApplied,
            reason: "unsettled identity debt transfer",
            externalReference: `identity_debt:${identityHash}`,
        });
        await tx
          .delete(unsettledCreditDebts)
          .where(eq(unsettledCreditDebts.identityHash, identityHash));
      }
      await tx
        .update(users)
        .set({
          adultVerifiedAt: new Date(),
          adultIdentityHash: identityHash,
          debtIdentityHash: paidDebt > 0 ? identityHash : null,
        })
        .where(eq(users.id, userId));

      return { adultVerified: true, debtApplied, paidDebt };
    });
  }

  async updateCurrentUserFromAuthorization(
    authorization: string | undefined,
    input:
      | { displayName?: unknown; bio?: unknown; profileImageUrl?: unknown }
      | undefined,
  ): Promise<PublicAuthUser> {
    const userId = await this.userIdFromAuthorization(authorization);
    const data: {
      displayName?: string;
      bio?: string;
      profileImageUrl?: string | null;
    } = {};
    if (input?.displayName !== undefined) {
      data.displayName = this.requiredString(input.displayName, "displayName");
    }
    if (input?.bio !== undefined) {
      data.bio = this.profileBio(input.bio);
    }
    if (input?.profileImageUrl !== undefined) {
      data.profileImageUrl = this.profileImageUrl(input.profileImageUrl);
    }
    if (Object.keys(data).length === 0) {
      throw new BadRequestException("profile update is required");
    }

    const [user] = await this.database.client
      .update(users)
      .set(data)
      .where(eq(users.id, userId))
      .returning(publicUserFields);
    return this.toPublicUser(await this.withAccountEmails(user));
  }

  private async issueTokens(
    user: PublicAuthUser,
    client: AuthSessionClient = this.database.client,
  ): Promise<AuthTokens> {
    const refreshToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(refreshToken);

    await client.insert(userRefreshTokens).values({ userId: user.id, tokenHash });

    return {
      user,
      accessToken: this.issueAccessToken(user.id),
      refreshToken,
    };
  }

  private async lockUserSessions(
    client: AuthSessionClient,
    userId: string,
  ): Promise<void> {
    const lockKey = `auth_sessions:${userId}`;
    await client.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  private async lockSocialIdentity(
    client: AuthSessionClient,
    provider: string,
    providerAccountId: string,
  ): Promise<void> {
    const lockKey = `social_identity:${provider}:${providerAccountId}`;
    await client.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  private async findSocialAccount(
    client: AuthSessionClient,
    provider: string,
    providerAccountId: string,
  ): Promise<SocialAccountRow | null> {
    const [row] = await client
      .select({
        id: userAccounts.id,
        email: userAccounts.email,
        user: {
          ...publicUserFields,
          deletedAt: users.deletedAt,
        },
      })
      .from(userAccounts)
      .innerJoin(users, eq(userAccounts.userId, users.id))
      .where(
        and(
          eq(userAccounts.provider, provider),
          eq(userAccounts.providerAccountId, providerAccountId),
        ),
      )
      .limit(1);
    return (row ?? null) as SocialAccountRow | null;
  }

  private async createAuthUser(
    input: {
      email: string;
      displayName: string;
      passwordHash: string;
      passwordSalt: string;
    },
    client: AuthSessionClient = this.database.client,
  ): Promise<AuthUser> {
    try {
      const [user] = await client
        .insert(users)
        .values(input)
        .returning(authUserFields);
      return user;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new ConflictException("Email is already registered");
      }
      throw error;
    }
  }

  private async findAuthUserByEmail(email: string): Promise<AuthUser | null> {
    const [user] = await this.database.client
      .select(authUserFields)
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return user ?? null;
  }

  private async findPublicUserById(id: string): Promise<PublicAuthUser | null> {
    const [user] = await this.database.client
      .select({ ...publicUserFields, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    if (!user || user.deletedAt) {
      return null;
    }
    return this.toPublicUser(await this.withAccountEmails(user));
  }

  private async findRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenRow | null> {
    const tokenHash = this.hashToken(refreshToken);

    const [row] = await this.database.client
      .select({
        tokenHash: userRefreshTokens.tokenHash,
        userId: userRefreshTokens.userId,
        revokedAt: userRefreshTokens.revokedAt,
        createdAt: userRefreshTokens.createdAt,
        user: publicUserFields,
      })
      .from(userRefreshTokens)
      .innerJoin(users, eq(userRefreshTokens.userId, users.id))
      .where(eq(userRefreshTokens.tokenHash, tokenHash))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      user: await this.withAccountEmails(row.user),
    };
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return derivedKey.toString("base64url");
  }

  private async passwordMatches(
    password: string,
    user: AuthUser,
  ): Promise<boolean> {
    if (!user.passwordHash || !user.passwordSalt) {
      return false;
    }
    const candidate = Buffer.from(
      await this.hashPassword(password, user.passwordSalt),
      "base64url",
    );
    const stored = Buffer.from(user.passwordHash, "base64url");
    return (
      candidate.length === stored.length && timingSafeEqual(candidate, stored)
    );
  }

  private signJwt(payload: JwtPayload): string {
    const encodedHeader = this.encodeJson({ alg: "HS256", typ: "JWT" });
    const encodedPayload = this.encodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac("sha256", this.jwtSecret())
      .update(signingInput)
      .digest("base64url");
    return `${signingInput}.${signature}`;
  }

  private verifyAccessToken(token: string): JwtPayload {
    const parts = token.split(".");
    if (parts.length !== 3) {
      throw new UnauthorizedException("Access token is invalid");
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const expectedSignature = createHmac("sha256", this.jwtSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");

    if (!this.safeEquals(signature, expectedSignature)) {
      throw new UnauthorizedException("Access token is invalid");
    }

    try {
      const header = JSON.parse(
        Buffer.from(encodedHeader, "base64url").toString("utf8"),
      ) as { alg?: string };
      const payload = JSON.parse(
        Buffer.from(encodedPayload, "base64url").toString("utf8"),
      ) as Partial<JwtPayload>;

      if (
        header.alg !== "HS256" ||
        typeof payload.sub !== "string" ||
        typeof payload.iat !== "number" ||
        typeof payload.exp !== "number"
      ) {
        throw new UnauthorizedException("Access token is invalid");
      }

      if (payload.exp <= Math.floor(Date.now() / 1000)) {
        throw new UnauthorizedException("Access token is expired");
      }

      return payload as JwtPayload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException("Access token is invalid");
    }
  }

  private bearerToken(authorization?: string): string {
    const [type, token] = authorization?.split(" ") ?? [];
    if (type !== "Bearer" || !token) {
      throw new UnauthorizedException("Bearer token is required");
    }
    return token;
  }

  private encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private safeEquals(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  private async lockUser(
    tx: AuthSessionClient,
    userId: string,
  ) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`,
    );
  }

  private async lockAdultIdentity(
    tx: AuthSessionClient,
    identityHash: string,
  ) {
    const lockKey = `adult_identity:${identityHash}`;
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
    );
  }

  private hashAdultIdentity(providerIdentityKey: string): string {
    if (providerIdentityKey.length > 512) {
      throw new BadRequestException("providerIdentityKey is too long");
    }
    const secret = process.env.ADULT_IDENTITY_HASH_SECRET?.trim();
    if (!secret) {
      throw new ServiceUnavailableException(
        "Adult identity hashing is not configured",
      );
    }
    return createHmac("sha256", secret)
      .update(providerIdentityKey)
      .digest("hex");
  }

  private jwtSecret(): string {
    const secret = process.env.AUTH_JWT_SECRET?.trim();
    if (!secret) {
      throw new Error("AUTH_JWT_SECRET is required");
    }
    return secret;
  }

  private refreshTokenTtlSeconds(): number {
    const configured = process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS?.trim();
    if (!configured) {
      return defaultRefreshTokenTtlSeconds;
    }

    const ttlSeconds = Number(configured);
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error(
        "AUTH_REFRESH_TOKEN_TTL_SECONDS must be a positive integer",
      );
    }
    return ttlSeconds;
  }

  private optionalWithdrawalReason(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (
      typeof value !== "string" ||
      !withdrawalReasonCategories.includes(value)
    ) {
      throw new BadRequestException("reasonCategory is invalid");
    }
    return value;
  }

  private optionalReasonText(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    if (typeof value !== "string") {
      throw new BadRequestException("reasonText must be a string");
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    if (trimmed.length > 500) {
      throw new BadRequestException(
        "reasonText must be at most 500 characters",
      );
    }
    return trimmed;
  }

  private normalizeEmail(email: unknown): string {
    const normalized = this.requiredString(email, "email").toLowerCase();
    if (!normalized.includes("@")) {
      throw new BadRequestException("Email is invalid");
    }
    return normalized;
  }

  private assertPassword(password: unknown): asserts password is string {
    if (
      typeof password !== "string" ||
      password.length < 8 ||
      password.length > 128
    ) {
      throw new BadRequestException("Password must be 8 to 128 characters");
    }
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }

  private randomSocialDisplayName(): string {
    return `사용자#${randomBytes(3).toString("hex").toUpperCase()}`;
  }

  private profileBio(value: unknown): string {
    if (typeof value !== "string") {
      throw new BadRequestException("bio must be a string");
    }
    const bio = value.trim();
    if (bio.length > 160) {
      throw new BadRequestException("bio must be at most 160 characters");
    }
    return bio;
  }

  private profileImageUrl(value: unknown): string | null {
    if (value === null) {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadRequestException("profileImageUrl must be a string");
    }
    const url = value.trim();
    if (!url) {
      return null;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("unsupported protocol");
      }
      return url;
    } catch {
      throw new BadRequestException("profileImageUrl must be an http URL");
    }
  }

  private toPublicUser(user: PublicAuthUserSource): PublicAuthUser {
    return {
      id: user.id,
      displayName: user.displayName,
      bio: user.bio,
      ...(user.profileImageUrl
        ? { profileImageUrl: user.profileImageUrl }
        : {}),
      email:
        user.email ??
        user.userAccounts?.find((account) => account.email)?.email ??
        null,
    };
  }

  private async withAccountEmails<T extends PublicAuthUserSource>(
    user: T,
  ): Promise<T> {
    const accounts = await this.database.client
      .select({ email: userAccounts.email })
      .from(userAccounts)
      .where(eq(userAccounts.userId, user.id))
      .orderBy(userAccounts.createdAt);
    return { ...user, userAccounts: accounts };
  }

  private toPublicUserFromRefresh(row: RefreshTokenRow): PublicAuthUser {
    if (!row.user) {
      throw new UnauthorizedException("Refresh token is invalid");
    }
    return this.toPublicUser(row.user);
  }
}
