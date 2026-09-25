import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PostsService } from "./posts.service";
import { PostRepository } from "./post.repository";
import { PostService } from "./post.service";
import { PostReactionRepository } from "./post-reaction.repository";
import { PostReactionService } from "./post-reaction.service";

@Module({
  imports: [DatabaseModule],
  providers: [
    PostsService,
    PostRepository,
    PostService,
    PostReactionRepository,
    PostReactionService,
  ],
  exports: [PostsService, PostService, PostReactionService],
})
export class PostsModule {}
