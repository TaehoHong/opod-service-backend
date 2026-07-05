import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { ReportsModule } from "../../domain/reports/reports.module";
import { ReportsController } from "./reports.controller";

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [ReportsController],
})
export class ServiceReportsModule {}
