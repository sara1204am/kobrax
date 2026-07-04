import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import type { ImportMode } from './import-plan';

export class ImportClientsDto {
  @IsIn(['csv', 'json']) source!: 'csv' | 'json';
  @IsIn(['RECONCILE', 'UPSERT_ONLY', 'REPLACE']) mode!: ImportMode;
  /** Vista previa sin escribir (preview/plan). */
  @IsOptional() @IsBoolean() dryRun?: boolean;
  /** Mapeo campo canónico → columna del archivo (default: identidad). */
  @IsOptional() @IsObject() mapping?: Record<string, string>;
  /** Contenido CSV crudo (cuando source = csv). */
  @IsOptional() @IsString() content?: string;
  /** Filas como objetos (cuando source = json). */
  @IsOptional() @IsArray() rows?: Record<string, unknown>[];
}
