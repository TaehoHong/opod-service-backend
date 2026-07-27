import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { ConsentsService } from "../../domain/consents/consents.service";

@Controller("terms")
export class TermsController {
  constructor(private readonly consentsService: ConsentsService) {}

  // 가입 화면이 동의 항목을 그려야 하므로 비로그인 공개다.
  @Get()
  listTerms() {
    return this.consentsService.listEffectiveDocuments();
  }

  @Get(":type")
  async getTerms(@Param("type") type: string) {
    const document = await this.consentsService.findEffectiveDocument(type);
    if (!document) {
      throw new NotFoundException("Terms document not found");
    }
    return document;
  }
}
