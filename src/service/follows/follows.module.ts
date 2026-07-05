import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { FollowsModule } from "../../domain/follows/follows.module";
import { FollowsController } from "./follows.controller";

@Module({
  imports: [AuthModule, FollowsModule],
  controllers: [FollowsController],
})
export class ServiceFollowsModule {}
