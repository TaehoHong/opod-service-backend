import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { CharactersModule } from "./characters.module";
import { FollowsModule } from "../follows/follows.module";
import { PostsModule } from "../posts/posts.module";
import { StoriesModule } from "../stories/stories.module";
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
