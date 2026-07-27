import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { ConsentsService } from "./consents.service";

@Module({
  imports: [PrismaModule],
  providers: [ConsentsService],
  exports: [ConsentsService],
})
export class ConsentsModule {}
