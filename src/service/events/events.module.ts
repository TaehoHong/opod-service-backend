import { Module } from "@nestjs/common";
import { AuthModule } from "../../domain/auth/auth.module";
import { EventsModule } from "../../domain/events/events.module";
import { EventsController } from "./events.controller";

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [EventsController],
})
export class ServiceEventsModule {}
