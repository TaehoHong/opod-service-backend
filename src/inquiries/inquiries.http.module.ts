import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { InquiriesModule } from "./inquiries.module";
import { InquiriesController } from "./inquiries.controller";

@Module({
  imports: [AuthModule, InquiriesModule],
  controllers: [InquiriesController],
})
export class ServiceInquiriesModule {}
