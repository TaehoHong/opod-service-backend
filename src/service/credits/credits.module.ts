import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { CreditsModule } from "../../domain/credits/credits.module";
import { CreditsController } from "./credits.controller";
import { CheckInController } from "./check-in.controller";

@Module({
  imports: [AuthModule, CreditsModule],
  controllers: [CreditsController, CheckInController],
})
export class ServiceCreditsModule {}
