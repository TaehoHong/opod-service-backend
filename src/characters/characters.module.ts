import { Module } from "@nestjs/common";
import { DatabaseModule } from "../core/database/database.module";
import { CharactersService } from "./characters.service";
import { CharacterRepository } from "./character.repository";
import { CharacterService } from "./character.service";

@Module({
  imports: [DatabaseModule],
  providers: [CharactersService, CharacterRepository, CharacterService],
  exports: [CharactersService, CharacterService],
})
export class CharactersModule {}
