import { IsString, Length } from 'class-validator';

/** El texto del enlace del correo (base64url de 32 bytes). */
export class EmailVerifyDto {
  @IsString() @Length(20, 100) token!: string;
}
