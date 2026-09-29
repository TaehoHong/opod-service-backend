import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ReportsModule } from "./reports.module";
import { ReportsController } from "./reports.controller";

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [ReportsController],
})
export class ServiceReportsModule {}
