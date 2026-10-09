import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { RouteStatus, RouteStopStatus } from '@prisma/client';
import { ROUTE_CHANGE_KINDS, ROUTE_REASON_MAX, ROUTE_SORTS, type RouteChangeKind, type RouteSort } from '@kobrax/shared';

/** Solo el día, `YYYY-MM-DD`: con una hora la comparación contra la columna `DATE` falla en silencio y choca con el único. */
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateRouteDto {
  /** Opcional: lo genera el móvil para que reintentar (cola offline) no duplique la ruta. */
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() collectorId!: string;
  @Matches(DAY, { message: 'plannedDate debe ser YYYY-MM-DD' }) plannedDate!: string;
  @IsOptional() @IsUUID() branchId?: string;
}

export class GenerateRouteDto {
  /** Opcional: ídem `CreateRouteDto.id`; un reintento devuelve la ruta ya generada, sin otras paradas. */
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() collectorId!: string;
  @Matches(DAY, { message: 'plannedDate debe ser YYYY-MM-DD' }) plannedDate!: string;
  /** Créditos a incluir, en el orden del recorrido; si se omite, toma los créditos en mora del cobrador por prioridad. */
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) creditIds?: string[];
  /**
   * La ubicación concreta de cada crédito (`creditId` → `client_locations.id`). Sin entrada, la parada usa la
   * ubicación principal del cliente, como siempre. Una ubicación que no sea del cliente se rechaza.
   */
  @IsOptional() @IsObject() locations?: Record<string, string>;
  /** Exige punto en el mapa en TODAS las paradas (el planificador del panel). El móvil de hoy no lo manda. */
  @IsOptional() @IsBoolean() requirePoints?: boolean;
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
  /**
   * El motivo escrito. **Obligatorio** al cancelar y al completar con paradas sin gestionar (y siempre que lo cambie
   * alguien que no es el cobrador ni quien armó la ruta). Sin cambios para el móvil de hoy: el cobrador que cierra
   * su propia ruta sigue sin mandarlo.
   */
  @IsOptional() @IsString() @MaxLength(ROUTE_REASON_MAX) reason?: string;
}

/** Agregar una parada desde el mapa (S2). El crédito es opcional: un cliente sin crédito elegido se visita igual. */
export class AddStopDto {
  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() creditId?: string;
  /** La ubicación concreta que se visita: de este cliente (propia o de un garante/familiar). */
  @IsOptional() @IsUUID() locationId?: string;
}

export class UpdateStopDto {
  @IsOptional() @IsEnum(RouteStopStatus) status?: RouteStopStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) sequenceOrder?: number;
}

/** Pedir un cambio sobre una ruta que armó otra persona. */
export class CreateChangeRequestDto {
  @IsIn(ROUTE_CHANGE_KINDS as unknown as string[]) kind!: RouteChangeKind;
  /** Lo que se pide: `{clientId, creditId?, locationId?}` · `{stopId}` · `{stopId, sequenceOrder}` · `{}`. */
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsString() @MaxLength(ROUTE_REASON_MAX) reason!: string;
}

export class DecideChangeRequestDto {
  @IsIn(['APPROVE', 'REJECT', 'WITHDRAW']) decision!: 'APPROVE' | 'REJECT' | 'WITHDRAW';
  @IsOptional() @IsString() @MaxLength(ROUTE_REASON_MAX) note?: string;
}

/** Un punto del recorrido que se está armando (todavía no es una parada). */
export class PlanPointDto {
  @IsString() @MaxLength(80) id!: string;
  @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude!: number;
  /** La hora fija de su visita agendada (`HH:mm`), si la tiene. */
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledTime debe ser HH:mm' }) scheduledTime?: string;
}

/** La vista previa de un recorrido que todavía no se publicó: los puntos, en el orden en que se piensa recorrerlos. */
export class PlanPreviewDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => PlanPointDto) points!: PlanPointDto[];
}

/** Un tramo suelto: de dónde está alguien hasta una parada. Para el botón «dónde estoy» de los mapas. */
export class LegDto {
  @ValidateNested() @Type(() => PlanPointDto) from!: PlanPointDto;
  @ValidateNested() @Type(() => PlanPointDto) to!: PlanPointDto;
}
