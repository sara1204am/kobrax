import { IsString, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // La política completa se valida server-side con passwordPolicy de @kobrax/shared.
  @IsString()
  @MinLength(1)
  newPassword!: string;
}
