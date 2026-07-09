import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { StoriesService } from "./stories.service";

@Module({
  imports: [PrismaModule],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule {}
