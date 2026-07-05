import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../database/prisma.module";
import { CreditsService } from "./credits.service";

@Module({
  imports: [AuthModule, PrismaModule],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
