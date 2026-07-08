import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";
import { decodeCursor, Page, pageFromRows, PageInput } from "../database/page";
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
  id: true,
  category: true,
  body: true,
  status: true,
  answeredAt: true,
  createdAt: true,
} as const;

@Injectable()
export class InquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  async createInquiry(input: {
    userId: string;
    category?: unknown;
    body?: unknown;
  }): Promise<InquiryListItem> {
    const category = this.requiredCategory(input.category);
    const body = this.requiredBody(input.body);

    const createdToday = await this.prisma.inquiry.count({
      where: {
        userId: input.userId,
        createdAt: { gte: kstDayStart(new Date()) },
      },
    });
    if (createdToday >= dailyInquiryLimit) {
      throw new HttpException(
        "Too many inquiries today",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return (await this.prisma.inquiry.create({
      data: { userId: input.userId, category, body },
      select: inquiryListFields,
    })) as InquiryListItem;
  }

  async listInquiriesPage(
    input: PageInput & { userId: string },
  ): Promise<Page<InquiryListItem>> {
    const cursorId = decodeCursor(input.cursor);
    const rows = (await this.prisma.inquiry.findMany({
      where: { userId: input.userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      select: inquiryListFields,
    })) as InquiryListItem[];
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
    return (await this.prisma.inquiry.findFirst({
      where: { id: input.inquiryId, userId: input.userId },
      select: { ...inquiryListFields, answerBody: true },
    })) as InquiryDetail | null;
  }

  async deleteInquiry(input: {
    userId: string;
    inquiryId: string;
  }): Promise<{ deleted: true }> {
    if (!isUuid(input.inquiryId)) {
      throw new NotFoundException("Inquiry not found");
    }
    const inquiry = await this.prisma.inquiry.findFirst({
      where: { id: input.inquiryId, userId: input.userId },
      select: { id: true, status: true },
    });
    if (!inquiry) {
      throw new NotFoundException("Inquiry not found");
    }
    if (inquiry.status !== "submitted") {
      throw new ConflictException("Inquiry already answered");
    }

    // status 조건부 삭제 — 판정과 삭제 사이에 답변이 달린 경합에서도
    // 답변된 문의(분쟁처리 기록)는 지워지지 않는다.
    const result = await this.prisma.inquiry.deleteMany({
      where: {
        id: input.inquiryId,
        userId: input.userId,
        status: "submitted",
      },
    });
    if (result.count === 0) {
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
