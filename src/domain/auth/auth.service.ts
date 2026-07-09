import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import {
  createHmac,
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { CreditsService } from "../credits/credits.service";
import { PrismaService } from "../database/prisma.service";

const scrypt = promisify(scryptCallback);

type AuthUser = {
  id: string;
  displayName: string;
  bio: string;
  profileImageUrl: string | null;
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

type PublicAuthUser = {
  id: string;
  displayName: string;
  bio: string;
  profileImageUrl?: string;
  email: string;
};

type RefreshTokenRow = {
  tokenHash: string;
  userId: string;
  revokedAt: Date | null;
  user?: {
    id: string;
    displayName: string;
    bio: string;
    profileImageUrl: string | null;
    email: string | null;
  };
};

type AuthTokens = {
  user: PublicAuthUser;
  accessToken: string;
  refreshToken: string;
};

type JwtPayload = {
  sub: string;
  iat: number;
  exp: number;
};

const authUserFields = {
  id: true,
  displayName: true,
  email: true,
  passwordHash: true,
  passwordSalt: true,
} as const;

const publicUserFields = {
  id: true,
  displayName: true,
  bio: true,
  profileImageUrl: true,
  email: true,
} as const;

const withdrawalReasonCategories = [
  "low_usage",
  "credit_cost",
  "content",
  "privacy",
  "etc",
];

const deletedUserDisplayName = "탈퇴한 사용자";

const signupBonusBlockDays = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creditsService: CreditsService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName: string;
  }): Promise<AuthTokens> {
    const email = this.normalizeEmail(input.email);
    const displayName = this.requiredString(input.displayName, "displayName");
    this.assertPassword(input.password);

    if (await this.findAuthUserByEmail(email)) {
      throw new ConflictException("Email is already registered");
    }

    const passwordSalt = randomBytes(16).toString("base64url");
    const passwordHash = await this.hashPassword(input.password, passwordSalt);

    const user = await this.createAuthUser({
      email,
      displayName,
      passwordHash,
      passwordSalt,
    });
    // 탈퇴 후 30일 내 동일 이메일 재가입은 가입 보너스를 다시 주지 않는다.
    if (!(await this.hasRecentWithdrawal(email))) {
      await this.creditsService.grantSignupBonus(user.id);
    }

    return this.issueTokens(this.toPublicUser(user));
  }

  async login(input: { email: string; password: string }): Promise<AuthTokens> {
    const email = this.normalizeEmail(input.email);
    const user = await this.findAuthUserByEmail(email);

    if (!user || !(await this.passwordMatches(input.password, user))) {
      throw new UnauthorizedException("Invalid email or password");
    }

    return this.issueTokens(this.toPublicUser(user));
  }

  async refresh(input: { refreshToken: string }): Promise<AuthTokens> {
    const row = await this.findRefreshToken(input.refreshToken);

    if (!row || row.revokedAt) {
      throw new UnauthorizedException("Refresh token is invalid");
    }

    await this.revokeRefreshToken(input.refreshToken);
    return this.issueTokens(this.toPublicUserFromRefresh(row));
  }

  async revokeRefreshToken(refreshToken: string): Promise<{ revoked: true }> {
    const tokenHash = this.hashToken(refreshToken);
    const row = await this.findRefreshToken(refreshToken);

    if (!row || row.revokedAt) {
      throw new UnauthorizedException("Refresh token is invalid");
    }

    await this.prisma.userRefreshToken.update({
      where: { tokenHash },
      data: { revokedAt: new Date() },
      select: { tokenHash: true },
    });
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
    if (!user?.email) {
      throw new UnauthorizedException("Access token is invalid");
    }
    return {
      id: user.id,
      displayName: user.displayName,
      bio: user.bio,
      ...(user.profileImageUrl
        ? { profileImageUrl: user.profileImageUrl }
        : {}),
      email: user.email,
    };
  }

  async changePasswordFromAuthorization(
    authorization: string | undefined,
    input: { currentPassword?: unknown; newPassword?: unknown } | undefined,
  ): Promise<AuthTokens> {
    const userId = await this.userIdFromAuthorization(authorization);

    const currentPassword = input?.currentPassword;
    if (typeof currentPassword !== "string" || !currentPassword) {
      throw new BadRequestException("currentPassword is required");
    }
    this.assertPassword(input?.newPassword);
    const newPassword = input?.newPassword as string;
    if (newPassword === currentPassword) {
      throw new BadRequestException("New password must be different");
    }

    const user = (await this.prisma.user.findUnique({
      where: { id: userId },
      select: authUserFields,
    })) as AuthUser | null;
    if (!user?.email) {
      throw new UnauthorizedException("Access token is invalid");
    }
    if (
      !user.passwordHash ||
      !user.passwordSalt ||
      !(await this.passwordMatches(currentPassword, user))
    ) {
      throw new BadRequestException("Current password is incorrect");
    }

    const passwordSalt = randomBytes(16).toString("base64url");
    const passwordHash = await this.hashPassword(newPassword, passwordSalt);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, passwordSalt },
        select: { id: true },
      }),
      this.prisma.userRefreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.userEvent.create({
        data: {
          userId,
          eventType: "auth.password_changed",
          targetType: "user",
          targetId: userId,
        },
      }),
    ]);

    return this.issueTokens(this.toPublicUser(user));
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

    const user = (await this.prisma.user.findUnique({
      where: { id: userId },
      select: authUserFields,
    })) as AuthUser | null;
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

    // 익명화 전에 미리 계산한다 — user.email은 아래 update로 null이 된다.
    const emailHash = this.hashEmail(user.email);

    // 정책 §2.3 데이터 처리 매트릭스. users 행은 유지하므로 cascade가
    // 발동하지 않는다 — 삭제는 전부 명시적으로 수행한다.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          passwordHash: null,
          passwordSalt: null,
          displayName: deletedUserDisplayName,
          bio: "",
          profileImageUrl: null,
          deletedAt: new Date(),
        },
        select: { id: true },
      }),
      this.prisma.userRefreshToken.deleteMany({ where: { userId } }),
      // 메시지는 conversation FK cascade로 함께 삭제된다.
      this.prisma.messageConversation.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.userCharacterFollow.deleteMany({ where: { userId } }),
      this.prisma.userHashtagPreference.deleteMany({ where: { userId } }),
      this.prisma.userWithdrawal.create({
        data: { userId, emailHash, reasonCategory, reasonText },
        select: { id: true },
      }),
    ]);

    return { deleted: true };
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

    const user = (await this.prisma.user.update({
      where: { id: userId },
      data,
      select: publicUserFields,
    })) as AuthUser;
    if (!user.email) {
      throw new UnauthorizedException("Access token is invalid");
    }
    return this.toPublicUser(user);
  }

  private async issueTokens(user: PublicAuthUser): Promise<AuthTokens> {
    const refreshToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(refreshToken);

    await this.prisma.userRefreshToken.create({
      data: { userId: user.id, tokenHash },
      select: { tokenHash: true, userId: true, revokedAt: true },
    });

    return {
      user,
      accessToken: this.issueAccessToken(user.id),
      refreshToken,
    };
  }

  private async createAuthUser(input: {
    email: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<AuthUser> {
    try {
      return (await this.prisma.user.create({
        data: input,
        select: authUserFields,
      })) as AuthUser;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        throw new ConflictException("Email is already registered");
      }
      throw error;
    }
  }

  private async findAuthUserByEmail(email: string): Promise<AuthUser | null> {
    return (await this.prisma.user.findUnique({
      where: { email },
      select: authUserFields,
    })) as AuthUser | null;
  }

  private async findPublicUserById(id: string): Promise<PublicAuthUser | null> {
    const user = (await this.prisma.user.findUnique({
      where: { id },
      select: { ...publicUserFields, deletedAt: true },
    })) as (AuthUser & { deletedAt: Date | null }) | null;
    if (!user || user.deletedAt || !user.email) {
      return null;
    }
    return this.toPublicUser(user);
  }

  private async findRefreshToken(
    refreshToken: string,
  ): Promise<RefreshTokenRow | null> {
    const tokenHash = this.hashToken(refreshToken);

    return this.prisma.userRefreshToken.findUnique({
      where: { tokenHash },
      select: {
        tokenHash: true,
        userId: true,
        revokedAt: true,
        user: { select: publicUserFields },
      },
    }) as Promise<RefreshTokenRow | null>;
  }

  private async hashPassword(password: string, salt: string): Promise<string> {
    const derivedKey = (await scrypt(password, salt, 64)) as Buffer;
    return derivedKey.toString("base64url");
  }

  private async passwordMatches(
    password: string,
    user: AuthUser,
  ): Promise<boolean> {
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

  private jwtSecret(): string {
    const secret = process.env.AUTH_JWT_SECRET?.trim();
    if (!secret) {
      throw new Error("AUTH_JWT_SECRET is required");
    }
    return secret;
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

  private async hasRecentWithdrawal(email: string): Promise<boolean> {
    const cutoff = new Date(
      Date.now() - signupBonusBlockDays * 24 * 60 * 60 * 1000,
    );
    const row = await this.prisma.userWithdrawal.findFirst({
      where: { emailHash: this.hashEmail(email), createdAt: { gte: cutoff } },
      select: { id: true },
    });
    return row !== null;
  }

  private hashEmail(email: string): string {
    return createHmac("sha256", this.emailHashPepper())
      .update(email)
      .digest("hex");
  }

  private emailHashPepper(): string {
    const pepper = process.env.AUTH_EMAIL_HASH_PEPPER?.trim();
    if (!pepper) {
      throw new Error("AUTH_EMAIL_HASH_PEPPER is required");
    }
    return pepper;
  }

  private normalizeEmail(email: string): string {
    const normalized = this.requiredString(email, "email").toLowerCase();
    if (!normalized.includes("@")) {
      throw new BadRequestException("Email is invalid");
    }
    return normalized;
  }

  private assertPassword(password: unknown) {
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

  private toPublicUser(user: AuthUser): PublicAuthUser {
    return {
      id: user.id,
      displayName: user.displayName,
      bio: user.bio,
      ...(user.profileImageUrl
        ? { profileImageUrl: user.profileImageUrl }
        : {}),
      email: user.email,
    };
  }

  private toPublicUserFromRefresh(row: RefreshTokenRow): PublicAuthUser {
    if (!row.user?.email) {
      throw new UnauthorizedException("Refresh token is invalid");
    }
    return {
      id: row.user.id,
      displayName: row.user.displayName,
      bio: row.user.bio,
      ...(row.user.profileImageUrl
        ? { profileImageUrl: row.user.profileImageUrl }
        : {}),
      email: row.user.email,
    };
  }
}
