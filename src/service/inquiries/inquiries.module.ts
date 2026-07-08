import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { InquiriesModule } from "../../domain/inquiries/inquiries.module";
import { InquiriesController } from "./inquiries.controller";

@Module({
  imports: [AuthModule, InquiriesModule],
  controllers: [InquiriesController],
})
export class ServiceInquiriesModule {}
