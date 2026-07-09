import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { CharactersModule } from "../../domain/characters/characters.module";
import { FollowsModule } from "../../domain/follows/follows.module";
import { PostsModule } from "../../domain/posts/posts.module";
import { StoriesModule } from "../../domain/stories/stories.module";
import { CharactersController } from "./characters.controller";

@Module({
  imports: [
    AuthModule,
    CharactersModule,
    FollowsModule,
    PostsModule,
    StoriesModule,
  ],
  controllers: [CharactersController],
})
export class ServiceCharactersModule {}
