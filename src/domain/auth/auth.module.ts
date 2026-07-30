import { Module } from "@nestjs/common";
import { ConsentsModule } from "../consents/consents.module";
import { CreditsModule } from "../credits/credits.module";
import { PrismaModule } from "../database/prisma.module";
import { AuthService } from "./auth.service";
import { GoogleSocialIdentityProvider } from "./google-social-identity.provider";
import {
  SOCIAL_IDENTITY_PROVIDERS,
  SocialIdentityProvider,
} from "./social-identity.provider";

@Module({
  imports: [ConsentsModule, CreditsModule, PrismaModule],
  providers: [
    GoogleSocialIdentityProvider,
    {
      provide: SOCIAL_IDENTITY_PROVIDERS,
      useFactory: (
        google: GoogleSocialIdentityProvider,
      ): SocialIdentityProvider[] => [google],
      inject: [GoogleSocialIdentityProvider],
    },
    AuthService,
  ],
  exports: [AuthService],
})
export class AuthModule {}
