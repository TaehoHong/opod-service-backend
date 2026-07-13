import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateReportDto {
  // No @IsEnum: ReportsService.parseTargetType validates the value and
  // returns its own error message.
  @ApiProperty({ enum: ["character", "post", "message"] })
  @IsString()
  @IsNotEmpty()
  targetType!: "character" | "post" | "message";

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  targetId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  details?: string;
}

export class ReportReceiptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ["submitted", "reviewing", "resolved", "rejected"] })
  status!: "submitted" | "reviewing" | "resolved" | "rejected";

  @ApiProperty()
  createdAt!: string;
}
