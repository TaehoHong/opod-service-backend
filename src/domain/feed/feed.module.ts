import { Module } from "@nestjs/common";
import { EventsModule } from "../events/events.module";
import { FollowsModule } from "../follows/follows.module";
import { PostsModule } from "../posts/posts.module";
import { FeedService } from "./feed.service";

@Module({
  imports: [EventsModule, FollowsModule, PostsModule],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
