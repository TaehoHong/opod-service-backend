import { ApiProperty } from "@nestjs/swagger";

export class AuthUserDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty()
  bio!: string;

  @ApiProperty({ required: false })
  profileImageUrl?: string;

  @ApiProperty()
  email!: string;
}

export class UpdateAuthUserDto {
  @ApiProperty({ required: false })
  displayName?: string;

  @ApiProperty({ required: false })
  bio?: string;

  @ApiProperty({ required: false })
  profileImageUrl?: string | null;
}
