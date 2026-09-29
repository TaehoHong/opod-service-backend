import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { EventsModule } from "./events.module";
import { EventsController } from "./events.controller";

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [EventsController],
})
export class ServiceEventsModule {}
