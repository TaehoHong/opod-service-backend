import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CharactersModule } from "../characters/characters.module";
import { PrismaModule } from "../database/prisma.module";
import { EventsModule } from "../events/events.module";
import { UsersModule } from "../users/users.module";
import { FollowsService } from "./follows.service";

@Module({
  imports: [
    AuthModule,
    CharactersModule,
    EventsModule,
    PrismaModule,
    UsersModule,
  ],
  providers: [FollowsService],
  exports: [FollowsService],
})
export class FollowsModule {}
