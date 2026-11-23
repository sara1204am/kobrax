import { IsString, Length, Matches } from 'class-validator';

/**
 * Activar el interés moratorio en un crédito que nació sin él (F17 · F3-e, D8). Toma la política de la cuenta vigente AL ACTIVAR.
 * `startsOn` es el primer día que puede correr el devengo: la API exige que sea posterior a hoy (nunca retroactivo).
 */
export class CreateLateActivationDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startsOn debe ser una fecha YYYY-MM-DD' })
  startsOn!: string;

  @IsString() @Length(3, 500)
  reason!: string;
}
