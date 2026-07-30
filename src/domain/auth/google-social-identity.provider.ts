import { Injectable, UnauthorizedException } from "@nestjs/common";
import { OAuth2Client } from "google-auth-library";
import {
  SocialIdentityProvider,
  VerifiedSocialIdentity,
} from "./social-identity.provider";

const invalidSocialTokenMessage = "유효하지 않은 소셜 로그인 토큰입니다";

@Injectable()
export class GoogleSocialIdentityProvider implements SocialIdentityProvider {
  readonly provider = "google";

  private readonly audience: string;
  private readonly client: OAuth2Client;

  constructor() {
    const audience = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
    if (!audience) {
      throw new Error("GOOGLE_OAUTH_CLIENT_ID is required");
    }
    this.audience = audience;
    this.client = new OAuth2Client();
  }

  async verify(idToken: string): Promise<VerifiedSocialIdentity> {
    try {
      const ticket = await this.client.verifyIdToken({
        idToken,
        audience: this.audience,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub) {
        throw new Error("Google ID token subject is missing");
      }

      const email =
        payload.email_verified && payload.email?.trim()
          ? payload.email.trim().toLowerCase()
          : undefined;
      const displayName = payload.name?.trim() || undefined;

      return {
        providerAccountId: payload.sub,
        ...(email ? { email } : {}),
        ...(displayName ? { displayName } : {}),
      };
    } catch {
      throw new UnauthorizedException(invalidSocialTokenMessage);
    }
  }
}
