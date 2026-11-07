import { ArrayMaxSize, IsArray, IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SUPPORT_MAX_TTL_MINUTES } from '@kobrax/shared';

export class PlatformLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  /** Código TOTP de 6 dígitos. Obligatorio una vez enrolado el MFA. */
  @IsOptional() @IsString() @Length(6, 8) code?: string;
}

export class PlatformMfaConfirmDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @IsString() @Length(6, 8) code!: string;
}

export class OpenSupportSessionDto {
  @IsUUID() accountId!: string;
  @IsString() @Length(10, 500) reason!: string;
  @IsOptional() @IsString() @MaxLength(80) ticket?: string;
  @IsInt() @Min(1) @Max(SUPPORT_MAX_TTL_MINUTES) ttlMinutes!: number;
  @IsArray() @ArrayMaxSize(120) @IsString({ each: true }) permissions!: string[];
}
