import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RouteStatus, RouteStopStatus } from '@prisma/client';

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
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsEnum(RouteStatus) status?: RouteStatus;
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
