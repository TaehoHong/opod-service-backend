import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CharactersModule } from "../characters/characters.module";
import { PrismaModule } from "../database/prisma.module";
import { PostsModule } from "../posts/posts.module";
import { EventsService } from "./events.service";

@Module({
  imports: [AuthModule, CharactersModule, PostsModule, PrismaModule],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
