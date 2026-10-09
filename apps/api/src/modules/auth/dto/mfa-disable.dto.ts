import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Deshabilitar MFA exige re-autenticación: password actual O un código MFA vigente. */
export class MfaDisableDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  code?: string;
}
