import { Module } from "@nestjs/common";
import { CharactersModule } from "../characters/characters.module";
import { CreditsModule } from "../credits/credits.module";
import { PrismaModule } from "../database/prisma.module";
import { EventsModule } from "../events/events.module";
import {
  createMessageReplyProvider,
  MESSAGE_REPLY_PROVIDER,
} from "./message-reply.provider";
import { MessagesService } from "./messages.service";

@Module({
  imports: [CharactersModule, CreditsModule, EventsModule, PrismaModule],
  providers: [
    MessagesService,
    { provide: MESSAGE_REPLY_PROVIDER, useFactory: createMessageReplyProvider },
  ],
  exports: [MessagesService],
})
export class MessagesModule {}
