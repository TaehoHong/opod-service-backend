import {
  Body,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
} from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { ReportsService } from "../../domain/reports/reports.service";

@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  async createReport(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: Parameters<ReportsService["createReport"]>[0],
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.reportsService.createReport({ ...body, userId });
  }

  @Get(":id")
  async getReport(
    @Param("id") reportId: string,
    @Headers("authorization") authorization: string | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    const report = await this.reportsService.findReportForUser({
      userId,
      reportId,
    });
    if (!report) {
      throw new NotFoundException("Report not found");
    }
    return report;
  }
}
