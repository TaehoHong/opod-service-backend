import { Module } from "@nestjs/common";
import { FaqsModule } from "../../domain/faqs/faqs.module";
import { FaqsController } from "./faqs.controller";

@Module({
  imports: [FaqsModule],
  controllers: [FaqsController],
})
export class ServiceFaqsModule {}
