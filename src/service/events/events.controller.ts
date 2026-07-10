import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import {
  ClientEventInput,
  EventsService,
} from "../../domain/events/events.service";

@Controller("events")
export class EventsController {
  constructor(
    private readonly eventsService: EventsService,
    private readonly authService: AuthService,
  ) {}

  @Post()
  @HttpCode(202)
  async recordEvent(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: ClientEventInput,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.eventsService.recordClientEvent(userId, body);
  }
}
