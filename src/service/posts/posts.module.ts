import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { PostsModule } from "../../domain/posts/posts.module";
import { PostsController } from "./posts.controller";

@Module({
  imports: [AuthModule, PostsModule],
  controllers: [PostsController],
})
export class ServicePostsModule {}
