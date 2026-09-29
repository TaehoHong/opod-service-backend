import { ApiProperty } from "@nestjs/swagger";

class StoryMediaDto {
  @ApiProperty({ enum: ["image", "video"] })
  mediaType!: "image" | "video";

  @ApiProperty()
  url!: string;

  @ApiProperty({ required: false })
  width?: number;

  @ApiProperty({ required: false })
  height?: number;

  @ApiProperty({ required: false })
  durationSeconds?: number;
}

export class StoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  characterId!: string;

  @ApiProperty()
  caption!: string;

  @ApiProperty({ type: StoryMediaDto })
  media!: StoryMediaDto;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  expiresAt!: string;
}

export class StoryPageDto {
  @ApiProperty({ type: [StoryDto] })
  items!: StoryDto[];

  @ApiProperty({ required: false })
  nextCursor?: string;
}
