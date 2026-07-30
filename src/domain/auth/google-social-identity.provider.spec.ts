import { UnauthorizedException } from "@nestjs/common";
import type { LoginTicket } from "google-auth-library";
import { OAuth2Client } from "google-auth-library";
import { GoogleSocialIdentityProvider } from "./google-social-identity.provider";

const verifyIdTokenSpy = () =>
  jest.spyOn(
    OAuth2Client.prototype as unknown as {
      verifyIdToken(input: {
        idToken: string;
        audience: string;
      }): Promise<LoginTicket>;
    },
    "verifyIdToken",
  );

describe("GoogleSocialIdentityProvider", () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "google-client-id";
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  });

  it("maps the stable subject and only a verified email", async () => {
    const verifyIdToken = verifyIdTokenSpy().mockResolvedValue({
      getPayload: () => ({
        sub: "google-subject",
        email: "Reader@Example.com",
        email_verified: true,
        name: " Google Reader ",
      }),
    } as LoginTicket);

    const provider = new GoogleSocialIdentityProvider();

    await expect(provider.verify("google-id-token")).resolves.toEqual({
      providerAccountId: "google-subject",
      email: "reader@example.com",
      displayName: "Google Reader",
    });
    expect(verifyIdToken).toHaveBeenCalledWith({
      idToken: "google-id-token",
      audience: "google-client-id",
    });
  });

  it("does not expose an unverified email", async () => {
    verifyIdTokenSpy().mockResolvedValue({
      getPayload: () => ({
        sub: "google-subject",
        email: "reader@example.com",
        email_verified: false,
      }),
    } as LoginTicket);

    await expect(
      new GoogleSocialIdentityProvider().verify("google-id-token"),
    ).resolves.toEqual({
      providerAccountId: "google-subject",
    });
  });

  it("normalizes all Google verification failures to the public 401", async () => {
    verifyIdTokenSpy().mockRejectedValue(new Error("wrong audience"));

    await expect(
      new GoogleSocialIdentityProvider().verify("google-id-token"),
    ).rejects.toEqual(
      new UnauthorizedException("유효하지 않은 소셜 로그인 토큰입니다"),
    );
  });

  it("fails fast when the Google audience is missing", () => {
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;

    expect(() => new GoogleSocialIdentityProvider()).toThrow(
      "GOOGLE_OAUTH_CLIENT_ID is required",
    );
  });
});
