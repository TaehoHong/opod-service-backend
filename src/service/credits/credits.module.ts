import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { CreditsModule } from "../../domain/credits/credits.module";
import { CreditsController } from "./credits.controller";

@Module({
  imports: [AuthModule, CreditsModule],
  controllers: [CreditsController],
})
export class ServiceCreditsModule {}
