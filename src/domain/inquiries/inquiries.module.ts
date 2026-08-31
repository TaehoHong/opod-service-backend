import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { InquiriesService } from "./inquiries.service";

@Module({
  imports: [DatabaseModule],
  providers: [InquiriesService],
  exports: [InquiriesService],
})
export class InquiriesModule {}
