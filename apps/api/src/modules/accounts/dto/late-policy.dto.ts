import { IsIn, IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { LATE_POLICY_KINDS, LATE_POLICY_LIMITS, type LatePolicyDayCount, type LatePolicyKind } from '@kobrax/shared';

/**
 * Cambia la política de interés moratorio de la cuenta (crea una VERSIÓN nueva). Con `NONE` no se aceptan parámetros; con
 * `ANNUAL_RATE` la tasa y la convención de días son obligatorias. La coherencia entre campos la valida `validateLatePolicy` de `shared`
 * (la misma regla que la pantalla); acá sólo se acotan tipos y rangos.
 */
export class UpdateLatePolicyDto {
  @IsIn(LATE_POLICY_KINDS) kind!: LatePolicyKind;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(LATE_POLICY_LIMITS.maxAnnualRate) annualRate?: number;
  @IsOptional() @IsIn([360, 365]) dayCount?: LatePolicyDayCount;
  @IsOptional() @IsInt() @Min(0) @Max(LATE_POLICY_LIMITS.maxGraceDays) graceDays?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 4 }) @Min(0.0001) @Max(LATE_POLICY_LIMITS.maxCapPct) capPctOfPrincipal?: number;
}
