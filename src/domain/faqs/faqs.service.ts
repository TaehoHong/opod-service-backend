import { Injectable } from "@nestjs/common";
import { and, asc, desc, eq } from "drizzle-orm";
import { DatabaseService } from "../database/database.service";
import { faqs } from "../database/schema";

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
  constructor(private readonly database: DatabaseService) {}

  async listPublishedFaqs(category?: string): Promise<{ items: FaqItem[] }> {
    const normalizedCategory = category?.trim();
    const items = await this.database.client
      .select({
        id: faqs.id,
        category: faqs.category,
        question: faqs.question,
        answer: faqs.answer,
        sortOrder: faqs.sortOrder,
      })
      .from(faqs)
      .where(
        and(
          eq(faqs.isPublished, true),
          normalizedCategory
            ? eq(faqs.category, normalizedCategory)
            : undefined,
        ),
      )
      .orderBy(asc(faqs.sortOrder), desc(faqs.createdAt))
      .limit(maxFaqItems);
    return { items };
  }
}
