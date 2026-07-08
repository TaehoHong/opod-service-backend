import { Module } from "@nestjs/common";
import { NoticesModule } from "../../domain/notices/notices.module";
import { NoticesController } from "./notices.controller";

@Module({
  imports: [NoticesModule],
  controllers: [NoticesController],
})
export class ServiceNoticesModule {}
