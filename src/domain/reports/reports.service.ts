import { BadRequestException, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import {
  characters,
  messageConversations,
  messages,
  posts,
  reports,
} from "../database/schema";
import { isUuid } from "../database/uuid";

type ReportTargetType = "character" | "post" | "message";
type ReportStatus = "submitted" | "reviewing" | "resolved" | "rejected";

type ReportReceipt = {
  id: string;
  status: ReportStatus;
  createdAt: string;
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

type ReportRow = typeof reports.$inferSelect;

@Injectable()
export class ReportsService {
  constructor(private readonly database: DatabaseService) {}

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

    const [report] = await this.database.client
      .insert(reports)
      .values({
        reporterUserId: input.userId,
        targetType,
        targetId,
        reason,
        details,
        status: "submitted",
      })
      .returning();
    return this.toReceipt(report);
  }

  async findReportForUser(input: {
    userId: string;
    reportId: string;
  }): Promise<ReportDetail | null> {
    if (!isUuid(input.reportId)) {
      return null;
    }
    const [report] = await this.database.client
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, input.reportId),
          eq(reports.reporterUserId, input.userId),
        ),
      )
      .limit(1);
    return report ? this.toDetail(report) : null;
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
      const [target] = await this.database.client
        .select({ id: characters.id })
        .from(characters)
        .where(eq(characters.id, targetId))
        .limit(1);
      return target !== undefined;
    }
    if (targetType === "post") {
      const [target] = await this.database.client
        .select({ id: posts.id })
        .from(posts)
        .where(eq(posts.id, targetId))
        .limit(1);
      return target !== undefined;
    }
    const [target] = await this.database.client
      .select({ id: messages.id })
      .from(messages)
      .innerJoin(
        messageConversations,
        eq(messages.conversationId, messageConversations.id),
      )
      .where(
        and(eq(messages.id, targetId), eq(messageConversations.userId, userId)),
      )
      .limit(1);
    return target !== undefined;
  }

  private toReceipt(report: ReportRow): ReportReceipt {
    return {
      id: report.id,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
    };
  }

  private toDetail(report: ReportRow): ReportDetail {
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
