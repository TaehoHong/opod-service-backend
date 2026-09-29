import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { FollowsModule } from "./follows.module";
import { FollowsController } from "./follows.controller";

@Module({
  imports: [AuthModule, FollowsModule],
  controllers: [FollowsController],
})
export class ServiceFollowsModule {}
