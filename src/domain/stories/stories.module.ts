import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { StoriesService } from "./stories.service";

@Module({
  imports: [DatabaseModule],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
