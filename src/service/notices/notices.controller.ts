import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { NoticesService } from "../../domain/notices/notices.service";
import { parsePageQuery } from "../../domain/database/page";

@Controller("notices")
export class NoticesController {
  constructor(private readonly noticesService: NoticesService) {}

  // 비로그인 공개 (정책 §4).
  @Get()
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  listNotices(
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    return this.noticesService.listPublishedNotices(
      parsePageQuery(cursor, limit),
    );
  }

  @Get(":id")
  async getNotice(@Param("id") noticeId: string) {
    const notice = await this.noticesService.findPublishedNotice(noticeId);
    if (!notice) {
      throw new NotFoundException("Notice not found");
    }
    return notice;
  }
}
