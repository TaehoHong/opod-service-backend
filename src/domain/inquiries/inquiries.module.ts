import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { InquiriesService } from "./inquiries.service";

@Module({
  imports: [PrismaModule],
  providers: [InquiriesService],
  exports: [InquiriesService],
})
export class InquiriesModule {}
