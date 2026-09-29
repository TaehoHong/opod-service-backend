import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "./notifications.module";
import { NotificationsController } from "./notifications.controller";

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [NotificationsController],
})
export class ServiceNotificationsModule {}
