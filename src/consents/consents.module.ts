import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { ConsentsService } from "./consents.service";

@Module({
  imports: [DatabaseModule],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
