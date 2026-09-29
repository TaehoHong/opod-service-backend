import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FeedModule } from "./feed.module";
import { FeedController } from "./feed.controller";

@Module({
  imports: [AuthModule, FeedModule],
  controllers: [FeedController],
})
export class ServiceFeedModule {}
