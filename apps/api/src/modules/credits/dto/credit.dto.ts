import { Type } from 'class-transformer';
import {
  IsBoolean,
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
import { CreditOrigin, PaymentFrequency } from '@kobrax/shared';
import type { AmortizationType } from '../credit-math';

export class CreateCreditDto {
  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() code?: string;

  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() principalAmount!: number;
  /** Tasa por período (por cuota), fracción. 0.025 = 2.5% por cuota. Informativa si hay `installmentAmount`. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) interestRate?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string; // default = moneda del tenant
  /** Vacío = **préstamo abierto/renovable** (spec §4.1). Obligatorio solo si se genera cronograma. */
  @IsOptional() @IsInt() @Min(0) @Max(600) installmentsCount?: number;

  @IsOptional() @IsIn(['FRENCH', 'FLAT']) amortizationType?: AmortizationType;
  @IsOptional() @IsDateString() disbursedAt?: string;
  @IsOptional() @IsDateString() firstDueDate?: string;
  @IsOptional() @IsUUID() assignedManagerId?: string;

  // ── Crédito de cobranza (spec §4). Con `installmentAmount` NO se genera cronograma: la cuota
  //    viene congelada y la próxima fecha es un dato, no una derivación.
  /** La cuota, ya calculada y redondeada por el móvil (§4.2). Su presencia define el modo de alta. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() installmentAmount?: number;
  @IsOptional() @IsEnum(PaymentFrequency) frequency?: PaymentFrequency;
  @IsOptional() @IsDateString() nextDueDate?: string;
  @IsOptional() @IsEnum(CreditOrigin) origin?: CreditOrigin;
  @IsOptional() @IsString() @Length(1, 64) externalRef?: string;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;

  /** "Este préstamo ya está en curso" (§4.1): el cobrador digitaliza cartera vieja. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) outstandingBalance?: number;
  @IsOptional() @IsInt() @Min(0) daysPastDue?: number;

  /** Abre el caso de cobranza en la misma transacción (§5.2). El alta del móvil siempre lo pide. */
  @IsOptional() @IsBoolean() openCase?: boolean;
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
