import { ApiProperty } from "@nestjs/swagger";
import { IsObject, IsOptional, IsString } from "class-validator";

// Fields stay optional at the validation layer so missing values still reach
// EventsService.normalizeEvent, which returns its own "<field> is required"
// messages and validates the supported event types.
export class ClientEventDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  eventType!: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  targetType!: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  targetId!: string;

  // Free-form record: a nested DTO under whitelist would strip unknown keys.
  @ApiProperty({
    additionalProperties: true,
    required: false,
    type: "object",
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
