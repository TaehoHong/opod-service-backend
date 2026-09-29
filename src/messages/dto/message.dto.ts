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

export class MarkConversationReadDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  characterId!: string;
}

export class RetryReplyDto {
  // 재시도할 턴을 가리키는 사용자 메시지 ID. 소유권과 상태 판정은 도메인이 한다.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  turnId!: string;
}
