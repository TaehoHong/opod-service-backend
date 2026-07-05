import { Module } from "@nestjs/common";
import { PostsModule } from "../../domain/posts/posts.module";
import { PostsController } from "./posts.controller";

@Module({
  imports: [PostsModule],
  controllers: [PostsController],
})
export class ServicePostsModule {}
