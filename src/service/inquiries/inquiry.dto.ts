import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

// Fields stay optional at the validation layer so missing values still reach
// InquiriesService, which owns the error messages ("category is invalid",
// "body is required", length limits).
export class CreateInquiryDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  body?: string;
}
