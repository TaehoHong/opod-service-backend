import { Module } from "@nestjs/common";
import { CharacterSocialModule } from "./character-social/character-social.module";
import { CoreModule } from "./core/core.module";

@Module({
  imports: [CharacterSocialModule, CoreModule],
})
export class AppModule {}
