import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { CaseActivityType, CasePriority, CaseStatus } from '@prisma/client';

export class CreateCaseDto {
  @IsUUID() creditId!: string;
  @IsOptional() @IsEnum(CasePriority) priority?: CasePriority;
}

export class GenerateCasesDto {
  /** Solo créditos con `days_past_due >= minDaysPastDue` (default: config del tenant). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minDaysPastDue?: number;
}

export class ListCasesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsEnum(CaseStatus) status?: CaseStatus;
  @IsOptional() @IsEnum(CasePriority) priority?: CasePriority;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsUUID() clientId?: string;
  /** 'true' → solo casos vencidos (sla_due_at < ahora, no cerrados). */
  @IsOptional() @IsIn(['true', 'false']) overdue?: string;
  /** 'true' → solo casos abiertos (excluye CLOSED/WRITTEN_OFF). Para el KPI de carga del día. */
  @IsOptional() @IsIn(['true', 'false']) open?: string;
  /** 'portfolio' → enriquece cada caso con zona, documento enmascarado y promesa vigente (lista de cartera V3). */
  @IsOptional() @IsIn(['portfolio']) view?: 'portfolio';
}

export class TransitionCaseDto {
  @IsEnum(CaseStatus) status!: CaseStatus;
  @IsOptional() @IsString() reason?: string;
}

export class AssignCaseDto {
  @IsOptional() @IsUUID() collectorId?: string;
  /** Asignación automática por menor carga. */
  @IsOptional() @IsBoolean() auto?: boolean;
}

export class CreateActivityDto {
  @IsEnum(CaseActivityType) type!: CaseActivityType;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() result?: string;
}

export class CloseCaseDto {
  @IsString() @IsNotEmpty() reason!: string;
}
