import { Module } from "@nestjs/common";
import { CreditsModule } from "../credits/credits.module";
import { PrismaModule } from "../database/prisma.module";
import { AuthService } from "./auth.service";

@Module({
  imports: [CreditsModule, PrismaModule],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
