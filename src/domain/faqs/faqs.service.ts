import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

export type FaqItem = {
  id: string;
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
};

// FAQ는 수십 건 규모로 운영한다 — 페이지네이션 없이 상한만 둔다.
const maxFaqItems = 200;

@Injectable()
export class FaqsService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublishedFaqs(category?: string): Promise<{ items: FaqItem[] }> {
    const normalizedCategory = category?.trim();
    const items = await this.prisma.faq.findMany({
      where: {
        isPublished: true,
        ...(normalizedCategory ? { category: normalizedCategory } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      take: maxFaqItems,
      select: {
        id: true,
        category: true,
        question: true,
        answer: true,
        sortOrder: true,
      },
    });
    return { items };
  }
}
