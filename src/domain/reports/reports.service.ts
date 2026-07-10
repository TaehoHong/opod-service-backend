import { BadRequestException, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { isUuid } from "../database/uuid";

type ReportTargetType = "character" | "post" | "message";
type ReportStatus = "submitted" | "reviewing" | "resolved" | "rejected";

type ReportReceipt = {
  id: string;
  status: ReportStatus;
  createdAt: string;
};

type PrismaReport = Omit<ReportReceipt, "createdAt"> & {
  createdAt: Date;
};

type ReportDetail = {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
  resolution: string | null;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
};

type PrismaReportDetail = Omit<ReportDetail, "createdAt" | "updatedAt"> & {
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async createReport(input: {
    userId: string;
    targetType: unknown;
    targetId: unknown;
    reason: unknown;
    details?: unknown;
  }): Promise<ReportReceipt> {
    const targetType = this.parseTargetType(input.targetType);
    const targetId =
      typeof input.targetId === "string" ? input.targetId.trim() : "";
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";

    if (
      input.details !== undefined &&
      input.details !== null &&
      typeof input.details !== "string"
    ) {
      throw new BadRequestException("Report details must be a string");
    }
    const details =
      typeof input.details === "string" ? input.details.trim() || null : null;

    if (!reason) {
      throw new BadRequestException("Report reason is required");
    }
    if (!targetId) {
      throw new BadRequestException("Report target is required");
    }
    if (!(await this.targetExists(input.userId, targetType, targetId))) {
      throw new BadRequestException("Report target not found");
    }

    const report = await this.prisma.report.create({
      data: {
        reporterUserId: input.userId,
        targetType,
        targetId,
        reason,
        details,
        status: "submitted",
      },
    });
    return this.toReceipt(report as PrismaReport);
  }

  async findReportForUser(input: {
    userId: string;
    reportId: string;
  }): Promise<ReportDetail | null> {
    if (!isUuid(input.reportId)) {
      return null;
    }
    const report = await this.prisma.report.findFirst({
      where: { id: input.reportId, reporterUserId: input.userId },
    });
    return report ? this.toDetail(report as PrismaReportDetail) : null;
  }

  private parseTargetType(targetType: unknown): ReportTargetType {
    if (
      targetType === "character" ||
      targetType === "post" ||
      targetType === "message"
    ) {
      return targetType;
    }
    throw new BadRequestException("Invalid report target type");
  }

  private async targetExists(
    userId: string,
    targetType: ReportTargetType,
    targetId: string,
  ): Promise<boolean> {
    if (!isUuid(targetId)) {
      return false;
    }
    if (targetType === "character") {
      return (
        (await this.prisma.character.findUnique({
          where: { id: targetId },
          select: { id: true },
        })) !== null
      );
    }
    if (targetType === "post") {
      return (
        (await this.prisma.post.findUnique({
          where: { id: targetId },
          select: { id: true },
        })) !== null
      );
    }
    return (
      (await this.prisma.message.findFirst({
        where: {
          id: targetId,
          conversation: { userId },
        },
        select: { id: true },
      })) !== null
    );
  }

  private toReceipt(report: PrismaReport): ReportReceipt {
    return {
      id: report.id,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    };
  }

  private toDetail(report: PrismaReportDetail): ReportDetail {
    return {
      id: report.id,
      targetType: report.targetType,
      targetId: report.targetId,
      reason: report.reason,
      details: report.details,
      resolution: report.resolution,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
}
