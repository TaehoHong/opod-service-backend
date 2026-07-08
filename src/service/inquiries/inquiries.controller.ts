import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  Post,
  Query,
} from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { InquiriesService } from "../../domain/inquiries/inquiries.service";
import { parsePageQuery } from "../pagination";

@Controller("inquiries")
export class InquiriesController {
  constructor(
    private readonly authService: AuthService,
    private readonly inquiriesService: InquiriesService,
  ) {}

  @Post()
  async createInquiry(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: { category?: unknown; body?: unknown } | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.inquiriesService.createInquiry({
      userId,
      category: body?.category,
      body: body?.body,
    });
  }

  @Get()
  async listInquiries(
    @Headers("authorization") authorization: string | undefined,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.inquiriesService.listInquiriesPage({
      ...parsePageQuery(cursor, limit),
      userId,
    });
  }

  @Get(":id")
  async getInquiry(
    @Param("id") inquiryId: string,
    @Headers("authorization") authorization: string | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    const inquiry = await this.inquiriesService.findInquiry({
      userId,
      inquiryId,
    });
    if (!inquiry) {
      throw new NotFoundException("Inquiry not found");
    }
    return inquiry;
  }

  @Delete(":id")
  async deleteInquiry(
    @Param("id") inquiryId: string,
    @Headers("authorization") authorization: string | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.inquiriesService.deleteInquiry({ userId, inquiryId });
  }
}
