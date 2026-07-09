import { Module } from "@nestjs/common";
import { StoriesModule } from "../../domain/stories/stories.module";
import { StoriesController } from "./stories.controller";

@Module({
  imports: [StoriesModule],
  controllers: [StoriesController],
})
export class ServiceStoriesModule {}
