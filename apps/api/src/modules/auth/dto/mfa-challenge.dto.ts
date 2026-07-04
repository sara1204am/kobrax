import { IsString, MinLength } from 'class-validator';

/** Paso MFA del login: pre-auth token + código (TOTP de 6 dígitos o backup code). */
export class MfaChallengeDto {
  @IsString()
  @MinLength(1)
  preAuthToken!: string;

  @IsString()
  @MinLength(6)
  code!: string;
}
