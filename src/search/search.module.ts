import { Module } from "@nestjs/common";
import { CharactersModule } from "../characters/characters.module";
import { PostsModule } from "../posts/posts.module";
import { HashtagsController, SearchController } from "./search.controller";

@Module({
  imports: [CharactersModule, PostsModule],
  controllers: [HashtagsController, SearchController],
})
export class ServiceSearchModule {}
