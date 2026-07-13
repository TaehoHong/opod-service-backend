import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class SendMessageDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  characterId!: string;

  // Optional at the validation layer so a missing value still reaches
  // MessagesService.sendMessage, which returns its own error message.
  @ApiProperty()
  @IsOptional()
  @IsString()
  body!: string;
}
