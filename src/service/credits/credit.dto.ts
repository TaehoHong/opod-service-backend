import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString } from "class-validator";

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

  @ApiProperty({ enum: ["grant", "usage", "refund_recovery", "adjustment"] })
  type!: "grant" | "usage" | "refund_recovery" | "adjustment";

  @ApiProperty({ enum: ["free", "paid"], required: false })
  creditKind?: "free" | "paid";

  @ApiProperty({ required: false })
  purchaseId?: string;

  @ApiProperty({ required: false })
  promotionCode?: string;

  @ApiProperty()
  amount!: number;

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
