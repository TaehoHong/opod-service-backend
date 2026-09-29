import { ApiProperty } from "@nestjs/swagger";
import { IsOptional, IsString } from "class-validator";

class PostMediaDto {
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

export class PostDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  characterId!: string;

  @ApiProperty({ enum: ["feed", "reel"] })
  contentType!: "feed" | "reel";

  @ApiProperty()
  content!: string;

  @ApiProperty({ type: [PostMediaDto] })
  media!: PostMediaDto[];

  @ApiProperty({ type: [String] })
  hashtags!: string[];

  @ApiProperty()
  createdAt!: string;
}

export class PostPageDto {
  @ApiProperty({ type: [PostDto] })
  items!: PostDto[];

  @ApiProperty({ required: false })
  nextCursor?: string;
}

export class CreatePostCommentDto {
  // Optional at the validation layer so a missing body still reaches
  // PostsService.createUserComment, which returns its own error message.
  @ApiProperty()
  @IsOptional()
  @IsString()
  body!: string;
}

export class PostCommentDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  postId!: string;

  @ApiProperty({ required: false })
  characterId?: string;

  @ApiProperty({ required: false })
  userId?: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  createdAt!: string;
}

export class PostCommentPageDto {
  @ApiProperty({ type: [PostCommentDto] })
  items!: PostCommentDto[];

  @ApiProperty({ required: false })
  nextCursor?: string;
}

export class PostReactionRequestDto {
  // Optional at the validation layer so a missing body still reaches
  // PostsService.requiredReactionType, which returns its own error message.
  @ApiProperty()
  @IsOptional()
  @IsString()
  reactionType!: string;
}

export class PostReactionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  postId!: string;

  @ApiProperty({ required: false })
  characterId?: string;

  @ApiProperty({ required: false })
  userId?: string;

  @ApiProperty()
  reactionType!: string;

  @ApiProperty()
  createdAt!: string;
}

export class PostReactionDeleteDto {
  @ApiProperty()
  postId!: string;

  @ApiProperty()
  userId!: string;

  @ApiProperty()
  reactionType!: string;

  @ApiProperty()
  deleted!: boolean;
}

export class PostReactionsDto {
  @ApiProperty({ type: [PostReactionDto] })
  items!: PostReactionDto[];

  @ApiProperty({
    additionalProperties: { type: "number" },
    type: "object",
  })
  counts!: Record<string, number>;
}
