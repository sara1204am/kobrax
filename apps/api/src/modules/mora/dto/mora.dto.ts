import { Type } from 'class-transformer';
import { IsBoolean, ValidateNested } from 'class-validator';
import { IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ActivityPromiseDto } from '../../cases/dto/case.dto';
import {
  ARREARS_SOURCES,
  CREDIT_SOURCES,
  MORA_NOTE_COLORS,
  MORA_NOTE_KINDS,
  MORA_NOTE_MAX_LENGTH,
  NOTE_BOARD_LIMITS,
  MORA_NOTE_ANCHORS,
  RECOVERY_ACTIVITY_TYPES,
  type ArrearsSource,
  type CreditSource,
  type MoraNoteAnchor,
  type MoraNoteColor,
  type MoraNoteKind,
} from '@kobrax/shared';

/**
 * Filtros de `GET /mora`.
 *
 * Viajan en la URL de una pantalla con panel de filtros, así que **lo desconocido no rebota con 400**:
 * `sort`, `priority` y `status` son `@IsString` suelto y el service los valida contra el enum, igual
 * que `ListCasesQueryDto`. Un link guardado de cuando había otro filtro tiene que abrir la lista.
 */
export class ListMoraQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;

  /** Nº de crédito, nombre del deudor (palabra por palabra) o zona. */
  @IsOptional() @IsString() @MaxLength(80) q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMax?: number;
  /** `'true'` = incluye los créditos al día. Por defecto sólo `dpd >= 1`. */
  @IsOptional() @IsIn(['true', 'false']) todos?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) balanceMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) balanceMax?: number;

  /** Prioridades del caso, separadas por coma. */
  @IsOptional() @IsString() @MaxLength(120) priority?: string;
  /** Estados del caso, separados por coma. */
  @IsOptional() @IsString() @MaxLength(200) status?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
  /** `'true'` = casos sin cobrador asignado. */
  @IsOptional() @IsIn(['true', 'false']) unassigned?: string;
  /** `'true'` = sólo con caso abierto · `'false'` = sólo sin caso. */
  @IsOptional() @IsIn(['true', 'false']) hasCase?: string;
  @IsOptional() @IsUUID() branchId?: string;
  /** `KOBRAX` = sin fuente externa. */
  @IsOptional() @IsIn(CREDIT_SOURCES as unknown as string[]) source?: CreditSource;
  /** De dónde salen los días de mora: calculada, del archivo o marcada a mano. */
  @IsOptional() @IsIn(ARREARS_SOURCES as unknown as string[]) arrearsSource?: ArrearsSource;
  @IsOptional() @IsIn(['true', 'false']) hasPromise?: string;
  /** `'true'` = SLA del caso vencido. **No es la mora del deudor.** */
  @IsOptional() @IsIn(['true', 'false']) overdue?: string;
  /** Sin gestión desde esa fecha; incluye a quien nunca tuvo. */
  @IsOptional() @IsDateString() noActionSince?: string;
  @IsOptional() @IsString() @MaxLength(60) zone?: string;

  /** Sin `@IsIn` a propósito: una clave desconocida cae al orden por defecto. */
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

/**
 * Crear una nota de un crédito.
 *
 * `id` opcional: lo puede traer quien escribe (el móvil, sin red) y **reintentar con el mismo id no duplica**.
 * El largo se valida acá y también en la base (`credit_notes_largo`): una nota vacía no es una nota.
 */
export class CreateMoraNoteDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsIn(MORA_NOTE_KINDS as unknown as string[]) kind?: MoraNoteKind;
  @IsString() @MinLength(1) @MaxLength(MORA_NOTE_MAX_LENGTH) body!: string;
  @IsOptional() @IsIn(MORA_NOTE_COLORS as unknown as string[]) color?: MoraNoteColor;
  /** Sección de la ficha en la que cae (`x`/`y` se miden desde ella). Sin ella, la ficha entera. */
  @IsOptional() @IsIn(MORA_NOTE_ANCHORS as unknown as string[]) anchor?: MoraNoteAnchor;
  /** Dónde cae en el tablero. Sin lugar, el servidor la pone en cascada. Se acota al tamaño permitido. */
  @IsOptional() @IsInt() @Min(0) @Max(100_000) x?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) y?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minWidth) @Max(NOTE_BOARD_LIMITS.maxWidth) w?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minHeight) @Max(NOTE_BOARD_LIMITS.maxHeight) h?: number;
}

/**
 * Editar una nota (PATCH): sólo lo que viene cambia.
 *
 * Cambiar el **texto o el tipo** es de quien la escribió o de quien reparte cartera; mover, redimensionar, pintar
 * o traer al frente lo puede quien pueda escribir sobre el crédito. El service lo hace cumplir.
 */
export class UpdateMoraNoteDto {
  @IsOptional() @IsIn(MORA_NOTE_KINDS as unknown as string[]) kind?: MoraNoteKind;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(MORA_NOTE_MAX_LENGTH) body?: string;
  @IsOptional() @IsIn(MORA_NOTE_COLORS as unknown as string[]) color?: MoraNoteColor;
  @IsOptional() @IsIn(MORA_NOTE_ANCHORS as unknown as string[]) anchor?: MoraNoteAnchor;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) x?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) y?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minWidth) @Max(NOTE_BOARD_LIMITS.maxWidth) w?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minHeight) @Max(NOTE_BOARD_LIMITS.maxHeight) h?: number;
  /** Traerla al frente del tablero. */
  @IsOptional() @IsBoolean() front?: boolean;
}

/**
 * Registrar una gestión sobre un crédito (`POST /mora/:creditId/activities`).
 *
 * El tipo y el resultado se validan acá sólo en su forma; **la regla de negocio** —qué resultado corresponde a
 * qué tipo, y que «promesa de pago» y la promesa van juntas— es `validateRecoveryActivity` de shared, que usa
 * también el panel.
 */
export class CreateMoraActivityDto {
  /** Lo puede poner el móvil (sin red): reintentar con el mismo id no duplica la gestión. */
  @IsOptional() @IsUUID() id?: string;
  @IsIn(RECOVERY_ACTIVITY_TYPES as unknown as string[]) type!: string;
  @IsOptional() @IsString() @MaxLength(40) result?: string;
  @IsOptional() @IsString() @MaxLength(MORA_NOTE_MAX_LENGTH + 200) notes?: string;
  @IsOptional() @ValidateNested() @Type(() => ActivityPromiseDto) promise?: ActivityPromiseDto;
}
