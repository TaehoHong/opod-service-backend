import { Module } from "@nestjs/common";
import { CharacterSocialModule } from "./domain/character-social/character-social.module";
import { ServiceModule } from "./service/service.module";

@Module({
  imports: [CharacterSocialModule, ServiceModule],
})
export class AppModule {}
