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
import { ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { InquiriesService } from "../../domain/inquiries/inquiries.service";
import { parsePageQuery } from "../../domain/database/page";
import { CreateInquiryDto } from "./inquiry.dto";

@Controller("inquiries")
export class InquiriesController {
  constructor(
    private readonly authService: AuthService,
    private readonly inquiriesService: InquiriesService,
  ) {}

  @Post()
  async createInquiry(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: CreateInquiryDto,
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
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
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
