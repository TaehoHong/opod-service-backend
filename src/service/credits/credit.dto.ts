import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateCheckoutDto {
  // No package-id check here: CreditsService rejects unknown packages with
  // its own "Unknown credit package" message.
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  creditPackageId!: string;
}

// Fields stay optional at the validation layer so missing values still reach
// CreditsService.handlePaymentWebhook, which owns the error messages.
export class PaymentWebhookDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  checkoutId?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  status?: string;
}

// Fields stay optional at the validation layer so missing values still reach
// CreditsService.validateEntryInput, which owns the ledger error messages.
export class SpendCreditsDto {
  @ApiProperty()
  @IsOptional()
  @IsNumber()
  amount!: number;

  @ApiProperty()
  @IsOptional()
  @IsString()
  reason!: string;
}

export class CreditCheckInDto {
  @ApiProperty()
  checkInDate!: string;

  @ApiProperty()
  creditsGranted!: number;

  @ApiProperty()
  milestoneBonus!: number;

  @ApiProperty()
  monthCheckInCount!: number;
}

export class CreditEntryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty({ enum: ["grant", "debit"] })
  entryType!: "grant" | "debit";

  @ApiProperty()
  amount!: number;

  @ApiProperty({ required: false })
  remainingAmount?: number;

  @ApiProperty({ required: false })
  expiresAt?: string;

  @ApiProperty()
  reason!: string;

  @ApiProperty({ required: false })
  externalReference?: string;

  @ApiProperty()
  createdAt!: string;
}

export class CreditEntryPageDto {
  @ApiProperty({ type: [CreditEntryDto] })
  items!: CreditEntryDto[];

  @ApiProperty({ required: false })
  nextCursor?: string;
}
