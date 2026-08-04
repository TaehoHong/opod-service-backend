import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreatePurchaseCheckoutDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  successUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  returnUrl?: string;
}

export class VerifyInAppPurchaseDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  productId!: string;

  @ApiProperty({
    description: "Apple signed transaction 또는 Google purchase token",
  })
  @IsString()
  @IsNotEmpty()
  proof!: string;
}

export class RequestPurchaseRefundDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}

export class ProductChannelQueryDto {
  @ApiProperty({ enum: ["web", "apple", "google"] })
  @IsIn(["web", "apple", "google"])
  channel!: "web" | "apple" | "google";
}
