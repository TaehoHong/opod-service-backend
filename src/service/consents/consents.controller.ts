import { Body, Controller, Get, Headers, Patch } from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { ConsentsService } from "../../domain/consents/consents.service";
import { UpdateConsentsDto } from "./consent.dto";

@Controller("consents")
export class ConsentsController {
  constructor(
    private readonly authService: AuthService,
    private readonly consentsService: ConsentsService,
  ) {}

  @Get()
  async listConsents(
    @Headers("authorization") authorization: string | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.consentsService.listUserConsents(userId);
  }

  @Patch()
  async updateConsents(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: UpdateConsentsDto,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.consentsService.updateUserConsents(userId, body?.consents);
  }
}
