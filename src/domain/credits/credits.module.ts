import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { CreditsService } from "./credits.service";

@Module({
  imports: [DatabaseModule],
  providers: [CreditsService],
  exports: [CreditsService],
})
export class CreditsModule {}
