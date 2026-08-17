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
  MaxLength,
  Min,
} from 'class-validator';
import { CreditStatus } from '@prisma/client';
import { CreditOrigin, PaymentFrequency } from '@kobrax/shared';
import type { AmortizationType } from '../credit-math';

export class CreateCreditDto {
  /**
   * Id propuesto por el móvil, para que el alta sea idempotente cuando viaja en la cola offline.
   * Mismo mecanismo que en `CreateClientDto`: un reintento reconoce el préstamo ya creado en vez
   * de darle dos al mismo deudor.
   */
  @IsOptional() @IsUUID() id?: string;

  @IsUUID() clientId!: string;
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsString() code?: string;
  /** Qué clase de crédito es → catálogo `CREDIT_TYPE` del tenant. El móvil no lo pregunta. */
  @IsOptional() @IsString() @MaxLength(64) typeCode?: string;

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
  @IsOptional() @IsString() @MaxLength(64) typeCode?: string;
  // ── Datos operativos editables desde la ficha (§4). BLOQUEADOS si el crédito es importado (§4.3).
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() principalAmount?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0) interestRate?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) installmentAmount?: number;
  @IsOptional() @IsEnum(PaymentFrequency) frequency?: PaymentFrequency;
  @IsOptional() @IsDateString() nextDueDate?: string;
  @IsOptional() @IsString() notes?: string;
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

/**
 * «Este préstamo está en mora», dicho a mano.
 *
 * Es para el prestamista que presta sin cronograma y sabe, sin mirar fechas, que le deben. Los días
 * son opcionales: sin ellos la mora arranca hoy. **No se guardan los días sino la fecha desde la que
 * corre** (`moraSince`), para que el número envejezca solo sin que nadie tenga que reescribirlo.
 */
export class MarkArrearsDto {
  /** Cuántos días lleva en mora. Vacío = desde hoy. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) days?: number;
}

/**
 * Cómo se pone al día un crédito. **Poner al día es mover la fecha**, no borrar el síntoma: si la
 * fecha sigue vencida el trabajo diario lo vuelve a marcar esta misma noche.
 *
 * · `next_period` — lo más común: pagó la cuota o se acordó la del período que viene.
 * · `date` — «me paga el viernes». Es la promesa de pago con sustancia.
 * · `none` — préstamo abierto/renovable, sin vencimiento pactado. Sin fecha no hay mora que contar.
 */
export const CURRENT_MODES = ['next_period', 'date', 'none'] as const;

export class ClearArrearsDto {
  @IsIn(CURRENT_MODES) mode!: (typeof CURRENT_MODES)[number];
  /** Obligatoria con `mode=date`, y tiene que ser futura: una fecha pasada deja el crédito en mora. */
  @IsOptional() @IsDateString() date?: string;
}
