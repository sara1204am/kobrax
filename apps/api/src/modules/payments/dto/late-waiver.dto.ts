import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsString, Length, Max, Min } from 'class-validator';

/** Exonerar interés moratorio de UNA cuota (F17 · F3-d). El motivo es obligatorio: queda en el hecho y en la auditoría. */
export class CreateLateWaiverDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  installmentNumber!: number;

  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(999_999_999)
  amount!: number;

  @IsString() @Length(3, 500)
  reason!: string;
}
