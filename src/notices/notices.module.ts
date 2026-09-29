import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { NoticesService } from "./notices.service";

@Module({
  imports: [DatabaseModule],
  providers: [NoticesService],
  exports: [NoticesService],
})
export class NoticesModule {}
