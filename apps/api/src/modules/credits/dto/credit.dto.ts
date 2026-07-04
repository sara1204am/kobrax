import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CreditStatus } from '@prisma/client';
import type { AmortizationType } from '../credit-math';

export class CreateCreditDto {
  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() code?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() principalAmount!: number;
  /** Tasa por período (por cuota), fracción. 0.025 = 2.5% por cuota. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) interestRate?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string; // default = moneda del tenant
  @IsInt() @Min(1) @Max(600) installmentsCount!: number;

  @IsOptional() @IsIn(['FRENCH', 'FLAT']) amortizationType?: AmortizationType;
  @IsOptional() @IsDateString() disbursedAt?: string;
  @IsOptional() @IsDateString() firstDueDate?: string;
  @IsOptional() @IsUUID() assignedManagerId?: string;
}

/** Solo campos editables tras el desembolso (no monto/tasa/cuotas/moneda → requieren reestructura). */
export class UpdateCreditDto {
  @IsOptional() @IsEnum(CreditStatus) status?: CreditStatus;
  @IsOptional() @IsUUID() assignedManagerId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() code?: string;
}

export class ListCreditsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsEnum(CreditStatus) status?: CreditStatus;
}

export class RecalcArrearsDto {
  /** Fecha de corte (default: ahora). Permite recálculos históricos reproducibles. */
  @IsOptional() @IsDateString() asOf?: string;
}
