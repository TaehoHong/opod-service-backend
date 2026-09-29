import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { MessagesModule } from "./messages.module";
import { MessagesController } from "./messages.controller";

@Module({
  imports: [AuthModule, MessagesModule],
  controllers: [MessagesController],
})
export class ServiceMessagesModule {}
