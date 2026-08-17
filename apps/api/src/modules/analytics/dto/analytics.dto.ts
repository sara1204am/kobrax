import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEnum, IsIn, IsOptional, IsUUID, Matches } from 'class-validator';
import { CasePriority, CaseStatus } from '@prisma/client';

/**
 * 🔴 **Sólo `YYYY-MM-DD`, y no cualquier fecha ISO.**
 *
 * `@IsDateString()` acepta `2026-08-13T10:00:00.000Z`, y el servicio arma la ventana concatenando
 * `T23:59:59.999Z` — con un timestamp adentro eso da `Invalid Date`, el rango entero queda en `NaN`
 * y **los seis endpoints contestan 500**. El BFF filtra el formato, pero la API es alcanzable
 * derecho: la guarda va donde se recibe.
 */
const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Los filtros que aceptan varios valores viajan **separados por coma** (`collectorId=a,b`).
 *
 * Es la forma que ya entiende un `URLSearchParams` sin ayuda —`String(['a','b'])` es `'a,b'`— y la
 * que deja el link del tablero legible. Un valor solo sigue siendo válido: es una lista de uno, así
 * que los links compartidos de antes siguen abriendo lo mismo.
 */
const Csv = (): PropertyDecorator =>
  Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()).filter(Boolean) : value,
  );

/**
 * Los filtros globales del dashboard. **Los seis endpoints reciben exactamente esto**: un widget
 * que ignorara uno mostraría otra cosa que sus vecinos, y nadie sabría cuál de los dos miente.
 */
export class AnalyticsQueryDto {
  /** `YYYY-MM-DD`. Sin rango, cada consulta usa el suyo por defecto (los últimos 7 días). */
  @IsOptional() @Matches(IS_DAY, { message: 'dateFrom debe ser YYYY-MM-DD' }) dateFrom?: string;
  @IsOptional() @Matches(IS_DAY, { message: 'dateTo debe ser YYYY-MM-DD' }) dateTo?: string;
  @IsOptional() @IsUUID() branchId?: string;
  /* El tope no es paranoia: cada valor es un parámetro más en el `IN` de seis consultas. */
  @IsOptional() @Csv() @IsArray() @ArrayMaxSize(50) @IsUUID(undefined, { each: true }) collectorId?: string[];
  @IsOptional() @Csv() @IsArray() @ArrayMaxSize(20) @IsEnum(CaseStatus, { each: true }) caseStatus?: CaseStatus[];
  @IsOptional() @Csv() @IsArray() @ArrayMaxSize(20) @IsEnum(CasePriority, { each: true }) priority?: CasePriority[];
}

export class TrendQueryDto extends AnalyticsQueryDto {
  @IsOptional() @IsIn(['day', 'week', 'month']) granularity?: 'day' | 'week' | 'month';
}
