import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { Allow, IsArray, IsOptional, ValidateNested } from "class-validator";
import { consentTypes } from "../../domain/consents/consents.service";

// RegisterDto와 같은 규칙: 파이프는 구조만 보고 값 검증과 에러 메시지는
// ConsentsService가 소유한다.
export class ConsentInputDto {
  @ApiProperty({ enum: consentTypes })
  @Allow()
  type?: string;

  @ApiProperty()
  @Allow()
  agreed?: boolean;
}

export class UpdateConsentsDto {
  @ApiProperty({ type: [ConsentInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsentInputDto)
  consents?: ConsentInputDto[];
}
