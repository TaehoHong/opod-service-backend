import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { FaqsService } from "./faqs.service";

@Module({
  imports: [DatabaseModule],
  providers: [FaqsService],
  exports: [FaqsService],
})
export class FaqsModule {}
