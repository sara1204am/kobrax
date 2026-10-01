import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { IMPORT_RUN_ITEM_ACTIONS, type ImportRunItemAction } from '@kobrax/shared';

/** Un día civil, sin hora: `@IsDateString` dejaría pasar una hora que después corre el día. */
const IS_DAY = /^\d{4}-\d{2}-\d{2}$/;

class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/**
 * El historial de importaciones, con la misma búsqueda y filtros que las tablas de la cartera.
 *
 * Dos fechas distintas a propósito: **cuándo se importó** (`from`/`to`, el día civil del tenant) y
 * **de qué día es el reporte** (`reportFrom`/`reportTo`, la fecha de corte). Se confunden fácil y no
 * son lo mismo: el reporte del 28 puede subirse el 30.
 */
export class ListImportRunsQueryDto extends PageQueryDto {
  /** Archivo, código de asesor o quién importó. */
  @IsOptional() @IsString() @MaxLength(100) @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) q?: string;
  @IsOptional() @Matches(IS_DAY) from?: string;
  @IsOptional() @Matches(IS_DAY) to?: string;
  @IsOptional() @Matches(IS_DAY) reportFrom?: string;
  @IsOptional() @Matches(IS_DAY) reportTo?: string;
  /** El usuario que importó. */
  @IsOptional() @IsUUID() createdBy?: string;
}

export class ListImportRunItemsQueryDto extends PageQueryDto {
  /** Sólo los movimientos de un tipo: las nuevas, las ausentes, las rechazadas… */
  @IsOptional() @IsIn(IMPORT_RUN_ITEM_ACTIONS as unknown as string[]) action?: ImportRunItemAction;
}
