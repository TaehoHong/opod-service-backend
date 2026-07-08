import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { FaqsService } from "./faqs.service";

@Module({
  imports: [PrismaModule],
  providers: [FaqsService],
  exports: [FaqsService],
})
export class FaqsModule {}
