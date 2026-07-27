import { Module } from "@nestjs/common";
import { ConsentsModule } from "../consents/consents.module";
import { CreditsModule } from "../credits/credits.module";
import { PrismaModule } from "../database/prisma.module";
import { AuthService } from "./auth.service";

@Module({
  imports: [ConsentsModule, CreditsModule, PrismaModule],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
