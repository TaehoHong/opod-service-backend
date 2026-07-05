import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Query,
} from "@nestjs/common";
import { AuthService } from "../../domain/auth/auth.service";
import { NotificationsService } from "../../domain/notifications/notifications.service";
import { parsePageQuery } from "../pagination";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly authService: AuthService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get()
  async listNotifications(
    @Headers("authorization") authorization: string | undefined,
    @Query("cursor") cursor?: string,
    @Query("limit") limit?: string,
    @Query("unreadOnly") unreadOnly?: string,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.notificationsService.listNotificationsPage({
      ...parsePageQuery(cursor, limit),
      userId,
      unreadOnly: parseUnreadOnly(unreadOnly),
    });
  }

  @Patch(":id/read")
  async markNotificationRead(
    @Param("id") notificationId: string,
    @Headers("authorization") authorization: string | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    const receipt = await this.notificationsService.markNotificationRead({
      userId,
      notificationId,
    });
    if (!receipt) {
      throw new NotFoundException("Notification not found");
    }
    return receipt;
  }
}

function parseUnreadOnly(value?: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new BadRequestException("unreadOnly must be true or false");
}
