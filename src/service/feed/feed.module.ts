import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { FeedModule } from "../../domain/feed/feed.module";
import { FeedController } from "./feed.controller";

@Module({
  imports: [AuthModule, FeedModule],
  controllers: [FeedController],
})
export class ServiceFeedModule {}
