export type VerifiedSocialIdentity = {
  providerAccountId: string;
  email?: string;
  displayName?: string;
};

export interface SocialIdentityProvider {
  readonly provider: string;
  verify(idToken: string): Promise<VerifiedSocialIdentity>;
}

export const SOCIAL_IDENTITY_PROVIDERS = Symbol("SOCIAL_IDENTITY_PROVIDERS");
