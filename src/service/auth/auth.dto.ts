import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  Allow,
  IsArray,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { ConsentInputDto } from "../consents/consent.dto";

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
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bio?: string;

  // @IsOptional also lets null through, which the service uses to clear the
  // profile image.
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  profileImageUrl?: string | null;
}

// Request DTO fields below stay optional (or type-free) at the validation
// layer so missing values still reach AuthService, which owns the error
// messages ("email is required", password policy, ...). The pipe only
// enforces structure and whitelists known fields.

export class RegisterDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  displayName?: string;

  // 시행 중인 필수 약관은 전부 agreed: true여야 가입이 통과한다.
  @ApiProperty({ type: [ConsentInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ConsentInputDto)
  consents?: ConsentInputDto[];
}

export class LoginDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  email?: string;

  // @Allow keeps the field through the whitelist without a type check: the
  // service folds wrong-typed passwords into 401 "Invalid email or password",
  // and a pipe-level 400 would change that contract.
  @ApiProperty()
  @Allow()
  password?: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  refreshToken?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  currentPassword?: string;

  @ApiProperty()
  @IsOptional()
  @IsString()
  newPassword?: string;
}

export class DeleteAccountDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  password?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reasonCategory?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reasonText?: string;
}

export class LocalAdultVerificationDto {
  @ApiProperty()
  @IsOptional()
  @IsString()
  providerIdentityKey?: string;
}
