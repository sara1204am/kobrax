import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EMAIL_MAX_LENGTH, LOGIN_PASSWORD_MAX_LENGTH } from '../../../common/validation/max-bytes';

/**
 * Mismas reglas que el formulario web (el servidor no confía solo en el navegador).
 * En el login la contraseña solo lleva un tope amplio: uno estricto dejaría afuera a quien ya
 * tiene una contraseña larga creada antes de que existiera el máximo de 72 bytes.
 */
export class LoginDto {
  @IsString({ message: 'Ingresa tu correo electrónico' })
  @IsNotEmpty({ message: 'Ingresa tu correo electrónico' })
  @MaxLength(EMAIL_MAX_LENGTH, { message: `El correo no puede superar ${EMAIL_MAX_LENGTH} caracteres` })
  @IsEmail({}, { message: 'El formato del correo no es válido' })
  email!: string;

  @IsString({ message: 'Ingresa tu contraseña' })
  @IsNotEmpty({ message: 'Ingresa tu contraseña' })
  @MaxLength(LOGIN_PASSWORD_MAX_LENGTH, {
    message: `La contraseña no puede superar ${LOGIN_PASSWORD_MAX_LENGTH} caracteres`,
  })
  password!: string;
}
