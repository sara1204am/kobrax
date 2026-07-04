import { Matches } from 'class-validator';

/** Confirma el enroll de MFA con un código TOTP de 6 dígitos. */
export class MfaVerifyDto {
  @Matches(/^\d{6}$/, { message: 'El código MFA debe tener 6 dígitos' })
  code!: string;
}
