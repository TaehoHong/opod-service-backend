import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { MessagesModule } from "../../domain/messages/messages.module";
import { MessagesController } from "./messages.controller";

@Module({
  imports: [AuthModule, MessagesModule],
  controllers: [MessagesController],
})
export class ServiceMessagesModule {}
