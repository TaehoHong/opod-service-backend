import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CharactersModule } from "../characters/characters.module";
import { DatabaseModule } from "../database/database.module";
import { PostsModule } from "../posts/posts.module";
import { EventsService } from "./events.service";

@Module({
  imports: [AuthModule, CharactersModule, PostsModule, DatabaseModule],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
