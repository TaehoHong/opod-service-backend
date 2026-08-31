import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { PostsService } from "./posts.service";

@Module({
  imports: [DatabaseModule],
  providers: [PostsService],
  exports: [PostsService],
})
export class PostsModule {}
