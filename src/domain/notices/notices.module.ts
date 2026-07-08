import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { NoticesService } from "./notices.service";

@Module({
  imports: [PrismaModule],
  providers: [NoticesService],
  exports: [NoticesService],
})
export class NoticesModule {}
