import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { NotificationsModule } from "../../domain/notifications/notifications.module";
import { NotificationsController } from "./notifications.controller";

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [NotificationsController],
})
export class ServiceNotificationsModule {}
