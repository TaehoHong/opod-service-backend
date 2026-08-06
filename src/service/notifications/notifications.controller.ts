import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiQuery } from "@nestjs/swagger";
import { AuthService } from "../../domain/auth/auth.service";
import { NotificationsService } from "../../domain/notifications/notifications.service";
import { parsePageQuery } from "../../domain/database/page";

@Controller("notifications")
export class NotificationsController {
  constructor(
    private readonly authService: AuthService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // 팔로우 알림은 앱이 이 경로를 부를 때 만들어진다. GET에 부수효과를 두지
  // 않으려고 별도 POST로 분리했다 — 앱이 노출 시점을 제어한다.
  @Post("sync")
  async syncFollowNotifications(
    @Headers("authorization") authorization: string | undefined,
  ) {
    const userId =
      await this.authService.userIdFromAuthorization(authorization);
    return this.notificationsService.syncFollowNotifications({ userId });
  }

  @Get()
  @ApiQuery({ name: "cursor", required: false })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "unreadOnly", required: false, enum: ["true", "false"] })
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
