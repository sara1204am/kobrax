import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RouteStatus, RouteStopStatus } from '@prisma/client';
import { ROUTE_SORTS, type RouteSort } from '@kobrax/shared';

export class CreateRouteDto {
  @IsUUID() collectorId!: string;
  @IsDateString() plannedDate!: string;
  @IsOptional() @IsUUID() branchId?: string;
}

export class GenerateRouteDto {
  @IsUUID() collectorId!: string;
  @IsDateString() plannedDate!: string;
  /** Casos a incluir; si se omite con `auto`, toma los casos abiertos del cobrador. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) caseIds?: string[];
  @IsOptional() @IsBoolean() auto?: boolean;
  @IsOptional() @IsUUID() branchId?: string;
}

export class ListRoutesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() collectorId?: string;
  /** Un día exacto. Es lo que pide el teléfono, que trabaja la jornada de hoy. */
  @IsOptional() @IsDateString() date?: string;
  /**
   * Un rango de días (`from`/`to`, inclusivos), para el historial por período del panel.
   *
   * Convive con `date` y no lo reemplaza: **si vienen los dos, manda `date`**. El móvil pide un día
   * y tiene que seguir recibiendo ese día, sin enterarse de que esto existe.
   */
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsEnum(RouteStatus) status?: RouteStatus;
  /** `date` (default) · `collector` · `status`. Lo que no esté en `ROUTE_SORTS` se ignora. */
  @IsOptional() @IsIn(ROUTE_SORTS as unknown as string[]) sort?: RouteSort;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}

export class UpdateRouteDto {
  @IsEnum(RouteStatus) status!: RouteStatus;
}

/** Agregar una parada desde el mapa (S2). El caso es opcional: un cliente sin caso abierto se visita igual. */
export class AddStopDto {
  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() caseId?: string;
}

export class UpdateStopDto {
  @IsOptional() @IsEnum(RouteStopStatus) status?: RouteStopStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sequenceOrder?: number;
}
