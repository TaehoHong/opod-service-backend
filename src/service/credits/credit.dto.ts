import { ApiProperty } from "@nestjs/swagger";

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
