import { IsEmail, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH } from '../../../common/validation/max-bytes';

export class ForgotPasswordDto {
  @MaxLength(EMAIL_MAX_LENGTH, { message: `El correo no puede superar ${EMAIL_MAX_LENGTH} caracteres` })
  @IsEmail({}, { message: 'El formato del correo no es válido' })
  email!: string;
}
