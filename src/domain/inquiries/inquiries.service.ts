import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, count, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { decodeCursor, Page, pageFromRows, PageInput } from "../database/page";
import { inquiries } from "../database/schema";
import { isUuid } from "../database/uuid";

export type InquiryListItem = {
  id: string;
  category: string;
  body: string;
  status: string;
  answeredAt: Date | null;
  createdAt: Date;
};

export type InquiryDetail = InquiryListItem & { answerBody: string | null };

const inquiryCategories = ["account", "credit", "bug", "content", "etc"];

const maxInquiryBodyLength = 2000;

// 도배 방지 — 1인당 하루(KST) 접수 한도 (정책 §5.1).
const dailyInquiryLimit = 10;

const inquiryListFields = {
  id: inquiries.id,
  category: inquiries.category,
  body: inquiries.body,
  status: inquiries.status,
  answeredAt: inquiries.answeredAt,
  createdAt: inquiries.createdAt,
};

@Injectable()
export class InquiriesService {
  constructor(private readonly database: DatabaseService) {}

  async createInquiry(input: {
    userId: string;
    category?: unknown;
    body?: unknown;
  }): Promise<InquiryListItem> {
    const category = this.requiredCategory(input.category);
    const body = this.requiredBody(input.body);
    const lockKey = `inquiry_daily:${input.userId}`;

    return this.database.client.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const dayStart = kstDayStart(new Date());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const [{ value: createdToday }] = await tx
        .select({ value: count() })
        .from(inquiries)
        .where(
          and(
            eq(inquiries.userId, input.userId),
            gte(inquiries.createdAt, dayStart),
            lt(inquiries.createdAt, dayEnd),
          ),
        );
      if (createdToday >= dailyInquiryLimit) {
        throw new HttpException(
          "Too many inquiries today",
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const [inquiry] = await tx
        .insert(inquiries)
        .values({ userId: input.userId, category, body })
        .returning(inquiryListFields);
      return inquiry;
    });
  }

  async listInquiriesPage(
    input: PageInput & { userId: string },
  ): Promise<Page<InquiryListItem>> {
    const cursorId = decodeCursor(input.cursor);
    const [cursor] = cursorId
      ? await this.database.client
          .select({ createdAt: inquiries.createdAt })
          .from(inquiries)
          .where(
            and(eq(inquiries.id, cursorId), eq(inquiries.userId, input.userId)),
          )
          .limit(1)
      : [];
    const rows = await this.database.client
      .select(inquiryListFields)
      .from(inquiries)
      .where(
        and(
          eq(inquiries.userId, input.userId),
          cursorId
            ? cursor
              ? or(
                  lt(inquiries.createdAt, cursor.createdAt),
                  and(
                    eq(inquiries.createdAt, cursor.createdAt),
                    lt(inquiries.id, cursorId),
                  ),
                )
              : sql`false`
            : undefined,
        ),
      )
      .orderBy(desc(inquiries.createdAt), desc(inquiries.id))
      .limit(input.limit + 1);
    return pageFromRows(rows, input.limit);
  }

  async findInquiry(input: {
    userId: string;
    inquiryId: string;
  }): Promise<InquiryDetail | null> {
    // uuid 형식이 아닌 id는 존재하지 않는 문의로 취급한다.
    if (!isUuid(input.inquiryId)) {
      return null;
    }
    // 본인 소유가 아니면 존재 여부를 노출하지 않는다 — 호출부에서 404.
    const [inquiry] = await this.database.client
      .select({ ...inquiryListFields, answerBody: inquiries.answerBody })
      .from(inquiries)
      .where(
        and(
          eq(inquiries.id, input.inquiryId),
          eq(inquiries.userId, input.userId),
        ),
      )
      .limit(1);
    return inquiry ?? null;
  }

  async deleteInquiry(input: {
    userId: string;
    inquiryId: string;
  }): Promise<{ deleted: true }> {
    if (!isUuid(input.inquiryId)) {
      throw new NotFoundException("Inquiry not found");
    }
    const [inquiry] = await this.database.client
      .select({ id: inquiries.id, status: inquiries.status })
      .from(inquiries)
      .where(
        and(
          eq(inquiries.id, input.inquiryId),
          eq(inquiries.userId, input.userId),
        ),
      )
      .limit(1);
    if (!inquiry) {
      throw new NotFoundException("Inquiry not found");
    }
    if (inquiry.status !== "submitted") {
      throw new ConflictException("Inquiry already answered");
    }

    // status 조건부 삭제 — 판정과 삭제 사이에 답변이 달린 경합에서도
    // 답변된 문의(분쟁처리 기록)는 지워지지 않는다.
    const deleted = await this.database.client
      .delete(inquiries)
      .where(
        and(
          eq(inquiries.id, input.inquiryId),
          eq(inquiries.userId, input.userId),
          eq(inquiries.status, "submitted"),
        ),
      )
      .returning({ id: inquiries.id });
    if (deleted.length === 0) {
      throw new ConflictException("Inquiry already answered");
    }
    return { deleted: true };
  }

  private requiredCategory(value: unknown): string {
    if (typeof value !== "string" || !inquiryCategories.includes(value)) {
      throw new BadRequestException("category is invalid");
    }
    return value;
  }

  private requiredBody(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new BadRequestException("body is required");
    }
    const trimmed = value.trim();
    if (trimmed.length > maxInquiryBodyLength) {
      throw new BadRequestException(
        `body must be at most ${maxInquiryBodyLength} characters`,
      );
    }
    return trimmed;
  }
}

// KST는 서머타임 없는 고정 UTC+9 — 당일 KST 자정의 UTC 시각.
function kstDayStart(now: Date): Date {
  const kstOffsetMs = 9 * 60 * 60 * 1000;
  const dayMs = 24 * 60 * 60 * 1000;
  const kstMs = now.getTime() + kstOffsetMs;
  return new Date(Math.floor(kstMs / dayMs) * dayMs - kstOffsetMs);
}
