import { Module } from "@nestjs/common";
import { CharactersModule } from "../characters/characters.module";
import { CreditsModule } from "../credits/credits.module";
import { PrismaModule } from "../database/prisma.module";
import { EventsModule } from "../events/events.module";
import {
  createMessageReplyProvider,
  MESSAGE_REPLY_PROVIDER,
} from "./message-reply.provider";
import {
  MESSAGE_REPLY_WORKER_OPTIONS,
  MessageReplyWorker,
  messageReplyWorkerOptions,
} from "./message-reply.worker";
import { MessagesService } from "./messages.service";

@Module({
  imports: [CharactersModule, CreditsModule, EventsModule, PrismaModule],
  providers: [
    MessagesService,
    MessageReplyWorker,
    { provide: MESSAGE_REPLY_PROVIDER, useFactory: createMessageReplyProvider },
    {
      provide: MESSAGE_REPLY_WORKER_OPTIONS,
      useFactory: () => messageReplyWorkerOptions(),
    },
  ],
  exports: [MessagesService, MessageReplyWorker, MESSAGE_REPLY_WORKER_OPTIONS],
})
export class MessagesModule {}
