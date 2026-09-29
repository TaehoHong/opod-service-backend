import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CreditsModule } from "./credits.module";
import { CreditsController } from "./credits.controller";
import { CheckInController } from "./check-in.controller";

@Module({
  imports: [AuthModule, CreditsModule],
  controllers: [CreditsController, CheckInController],
})
export class ServiceCreditsModule {}
