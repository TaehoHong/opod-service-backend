import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CharactersModule } from "../characters/characters.module";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { UsersModule } from "../users/users.module";
import { FollowsService } from "./follows.service";

@Module({
  imports: [
    AuthModule,
    CharactersModule,
    EventsModule,
    DatabaseModule,
    UsersModule,
  ],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
