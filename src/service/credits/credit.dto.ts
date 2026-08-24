import { ApiProperty } from "@nestjs/swagger";
import { IsNumber, IsOptional, IsString, Matches } from "class-validator";

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

export class CheckInQueryDto {
  @ApiProperty({ required: false, example: "2026-08" })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;
}

export class CheckInMilestoneDto {
  @ApiProperty()
  count!: number;

  @ApiProperty()
  bonusCredits!: number;

  @ApiProperty()
  achieved!: boolean;
}

export class CheckInStatusDto {
  @ApiProperty({ example: "2026-08-24" })
  today!: string;

  @ApiProperty({ example: "2026-08" })
  month!: string;

  @ApiProperty()
  checkedInToday!: boolean;

  @ApiProperty({ type: [String], example: ["2026-08-01", "2026-08-03"] })
  checkedInDates!: string[];

  @ApiProperty()
  monthCheckInCount!: number;

  @ApiProperty()
  dailyCredits!: number;

  @ApiProperty({ type: [CheckInMilestoneDto] })
  milestones!: CheckInMilestoneDto[];
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
