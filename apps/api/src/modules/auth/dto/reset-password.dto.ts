import { IsString, MaxLength, MinLength } from 'class-validator';
import { MaxBytes, PASSWORD_MAX_BYTES } from '../../../common/validation/max-bytes';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  token!: string;

  // La política completa se valida server-side con passwordPolicy de @kobrax/shared.
  @IsString()
  @MinLength(1)
  @MaxBytes(PASSWORD_MAX_BYTES)
  newPassword!: string;
}
