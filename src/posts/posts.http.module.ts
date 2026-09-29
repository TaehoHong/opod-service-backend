import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PostsModule } from "./posts.module";
import { PostsController } from "./posts.controller";

@Module({
  imports: [AuthModule, PostsModule],
  controllers: [PostsController],
})
export class ServicePostsModule {}
