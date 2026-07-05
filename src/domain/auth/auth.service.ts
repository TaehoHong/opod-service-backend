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
import { PrismaService } from "../database/prisma.service";

const scrypt = promisify(scryptCallback);

type AuthUser = {
  id: string;
  displayName: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
};

type PublicAuthUser = {
  id: string;
  displayName: string;
  email: string;
};

type RefreshTokenRow = {
  tokenHash: string;
  userId: string;
  revokedAt: Date | null;
  user?: {
    id: string;
    displayName: string;
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
  email: true,
} as const;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

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
      email: user.email,
    };
  }

  async updateCurrentUserFromAuthorization(
    authorization: string | undefined,
    input: { displayName?: unknown } | undefined,
  ): Promise<PublicAuthUser> {
    const userId = await this.userIdFromAuthorization(authorization);
    const displayName = this.requiredString(input?.displayName, "displayName");
    const user = (await this.prisma.user.update({
      where: { id: userId },
      data: { displayName },
      select: publicUserFields,
    })) as PublicAuthUser & { email: string | null };
    if (!user.email) {
      throw new UnauthorizedException("Access token is invalid");
    }
    return {
      id: user.id,
      displayName: user.displayName,
      email: user.email,
    };
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

  private async findPublicUserById(
    id: string,
  ): Promise<(PublicAuthUser & { email: string | null }) | null> {
    return (await this.prisma.user.findUnique({
      where: { id },
      select: publicUserFields,
    })) as (PublicAuthUser & { email: string | null }) | null;
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

  private normalizeEmail(email: string): string {
    const normalized = this.requiredString(email, "email").toLowerCase();
    if (!normalized.includes("@")) {
      throw new BadRequestException("Email is invalid");
    }
    return normalized;
  }

  private assertPassword(password: string) {
    if (typeof password !== "string" || password.length < 8) {
      throw new BadRequestException("Password must be at least 8 characters");
    }
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException(`${field} is required`);
    }
    return value.trim();
  }

  private toPublicUser(user: AuthUser): PublicAuthUser {
    return {
      id: user.id,
      displayName: user.displayName,
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
      email: row.user.email,
    };
  }
}
