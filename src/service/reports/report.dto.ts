import { ApiProperty } from "@nestjs/swagger";

export class CreateReportDto {
  @ApiProperty({ enum: ["character", "post", "message"] })
  targetType!: "character" | "post" | "message";

  @ApiProperty()
  targetId!: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ required: false })
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
