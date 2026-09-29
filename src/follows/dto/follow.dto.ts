import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString } from "class-validator";

export class FollowCharacterDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  characterId!: string;
}
