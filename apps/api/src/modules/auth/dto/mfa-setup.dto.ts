import { IsString, Matches, MinLength } from 'class-validator';

/** Inicio del setup MFA obligatorio durante el login (gated por pre-auth token). */
export class MfaSetupStartDto {
  @IsString()
  @MinLength(1)
  preAuthToken!: string;
}

/** Confirmación del setup MFA obligatorio: activa MFA y completa el login. */
export class MfaSetupVerifyDto {
  @IsString()
  @MinLength(1)
  preAuthToken!: string;

  @Matches(/^\d{6}$/, { message: 'El código MFA debe tener 6 dígitos' })
  code!: string;
}
