import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min, MinLength } from 'class-validator';
import { SUPPORT_MAX_TTL_MINUTES } from '@kobrax/shared';

export class PlatformLoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  /** Código TOTP de 6 dígitos. Obligatorio una vez enrolado el MFA. */
  @IsOptional() @IsString() @Length(6, 8) code?: string;
  /** Sólo para el PRIMER ingreso (enrolar el MFA): la clave de enrolamiento que tiene quien opera el servidor (`PLATFORM_ENROLLMENT_KEY`). */
  @IsOptional() @IsString() @MaxLength(200) enrollmentKey?: string;
}

export class PlatformMfaConfirmDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
  @IsString() @Length(6, 8) code!: string;
  @IsOptional() @IsString() @MaxLength(200) enrollmentKey?: string;
}

export class SetAccountStatusDto {
  /** Solo suspender o levantar la suspensión: la consola de plataforma no cambia la cuenta a ningún otro estado. */
  @IsIn(['SUSPENDED', 'ACTIVE']) status!: 'SUSPENDED' | 'ACTIVE';
  @IsString() @Length(10, 500) reason!: string;
}

export class OpenSupportSessionDto {
  @IsUUID() accountId!: string;
  @IsString() @Length(10, 500) reason!: string;
  @IsOptional() @IsString() @MaxLength(80) ticket?: string;
  @IsInt() @Min(1) @Max(SUPPORT_MAX_TTL_MINUTES) ttlMinutes!: number;
  @IsArray() @ArrayMaxSize(120) @IsString({ each: true }) permissions!: string[];
}
