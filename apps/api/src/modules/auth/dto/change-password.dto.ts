import { IsString, MaxLength, MinLength } from 'class-validator';
import { LOGIN_PASSWORD_MAX_LENGTH, MaxBytes, PASSWORD_MAX_BYTES } from '../../../common/validation/max-bytes';

export class ChangePasswordDto {
  // La actual puede ser una contraseña vieja y larga: tope amplio, como en el login.
  @IsString()
  @MinLength(1)
  @MaxLength(LOGIN_PASSWORD_MAX_LENGTH)
  currentPassword!: string;

  @IsString()
  @MinLength(1)
  @MaxBytes(PASSWORD_MAX_BYTES)
  newPassword!: string;
}
