import { ApiProperty } from "@nestjs/swagger";
import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from "class-validator";

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

export class ReserveCreditRefundDto {
  @ApiProperty()
  @IsUUID()
  purchaseId!: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  reference!: string;
}

export class LocalCreditRefundResultDto {
  @ApiProperty()
  @IsUUID()
  refundId!: string;

  @ApiProperty({ enum: ["succeeded", "failed"] })
  @IsIn(["succeeded", "failed"])
  status!: "succeeded" | "failed";
}

export class CreditRefundDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  purchaseId!: string;

  @ApiProperty({ enum: ["reserved", "refunded", "released"] })
  status!: "reserved" | "refunded" | "released";

  @ApiProperty()
  creditAmount!: number;

  @ApiProperty()
  promotionAmount!: number;

  @ApiProperty()
  grossAmount!: number;

  @ApiProperty()
  feeAmount!: number;

  @ApiProperty()
  refundAmount!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  reference!: string;

  @ApiProperty({
    enum: ["user_request", "company_fault", "company_price_adjustment"],
  })
  reason!: "user_request" | "company_fault" | "company_price_adjustment";
}

export class CreditRefundQuoteDto {
  @ApiProperty()
  purchaseId!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  originalCredits!: number;

  @ApiProperty()
  remainingCredits!: number;

  @ApiProperty()
  lockedCredits!: number;

  @ApiProperty()
  refundableCredits!: number;

  @ApiProperty()
  minimumCredits!: number;

  @ApiProperty()
  eligible!: boolean;

  @ApiProperty()
  grossAmount!: number;

  @ApiProperty()
  feeAmount!: number;

  @ApiProperty()
  refundAmount!: number;

  @ApiProperty()
  paidBalanceAfterRefund!: number;

  @ApiProperty()
  promotionRecoveryCredits!: number;

  @ApiProperty()
  expectedDebtIncrease!: number;
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

  @ApiProperty({ enum: ["free", "paid"], required: false })
  creditKind?: "free" | "paid";

  @ApiProperty({ required: false })
  purchaseId?: string;

  @ApiProperty({ required: false })
  promotionCode?: string;

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
