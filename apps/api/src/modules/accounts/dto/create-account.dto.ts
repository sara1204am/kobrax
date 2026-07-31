import { IsEmail, IsString, Length, MinLength } from 'class-validator';

/**
 * Registro público (CUENTA · S4). Es un endpoint **sin sesión**: este DTO es la
 * única frontera de confianza, así que valida longitudes y formato acá.
 *
 * La política completa de contraseña se valida server-side con `isPasswordValid`
 * de `@kobrax/shared` (mismo criterio que reset/change-password).
 *
 * País y moneda **no están a propósito** (S4-D8): arrancan en el default del
 * mercado y se configuran después en la pantalla de datos de la cuenta (S1).
 */
export class CreateAccountDto {
  @IsString() @Length(2, 160) businessName!: string;
  @IsString() @Length(1, 80) firstName!: string;
  @IsString() @Length(1, 80) lastName!: string;
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}
