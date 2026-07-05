import { Module } from "@nestjs/common";
import { PrismaModule } from "../database/prisma.module";
import { CharactersService } from "./characters.service";

@Module({
  imports: [PrismaModule],
  providers: [CharactersService],
  exports: [CharactersService],
})
export class CharactersModule {}
