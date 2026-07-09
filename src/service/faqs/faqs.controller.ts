import { Controller, Get, Query } from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { FaqsService } from "../../domain/faqs/faqs.service";

@Controller("faqs")
export class FaqsController {
  constructor(private readonly faqsService: FaqsService) {}

  // 비로그인 공개 — 비밀번호를 잊은 유저도 접근해야 한다 (정책 §3).
  @Get()
  @ApiQuery({ name: "category", required: false })
  listFaqs(@Query("category") category?: string) {
    return this.faqsService.listPublishedFaqs(category);
  }
}
