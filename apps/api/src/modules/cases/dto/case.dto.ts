import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
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
  /**
   * 'true' → solo casos cuyo **SLA** venció (`sla_due_at < ahora`), no cerrados.
   *
   * ⚠️ **No es la mora del deudor.** Son dos cosas distintas que en castellano se dicen igual: acá
   * «vencido» es que se pasó el tiempo que la empresa se dio para gestionar el caso; la mora del
   * crédito se filtra con `dpdMin`/`dpdMax`. Confundirlas hacía que la pantalla dijera «vencidos» y
   * mostrara casos de gente al día.
   */
  @IsOptional() @IsIn(['true', 'false']) overdue?: string;

  /**
   * Rango de días de mora **del crédito** (§ la pantalla de Mora abre con `dpdMin=1`).
   *
   * Va sobre la relación y no sobre el caso porque la mora vive en `credits.days_past_due`: es del
   * préstamo, no del expediente que lo gestiona.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMax?: number;

  /**
   * Búsqueda por nombre del deudor.
   *
   * Sólo el nombre: el documento y los teléfonos están cifrados y se buscan por blind index, que es
   * otro camino (el de la cartera). Con novecientas filas, encontrar a una persona no puede depender
   * de recordar en qué página estaba.
   */
  @IsOptional() @IsString() @MaxLength(80) q?: string;
  /** 'true' → solo casos abiertos (excluye CLOSED/WRITTEN_OFF). Para el KPI de carga del día. */
  @IsOptional() @IsIn(['true', 'false']) open?: string;
  /** 'portfolio' → enriquece cada caso con zona, documento enmascarado y promesa vigente (lista de cartera V3). */
  @IsOptional() @IsIn(['portfolio']) view?: 'portfolio';
  /**
   * Cómo ordenar: `priority` (default) · `daysPastDue` · `balance` · `slaDueAt` · `createdAt`.
   *
   * A propósito **sin `@IsIn`**: una clave desconocida cae al orden por defecto en el service en
   * vez de responder 400. Viaja en la URL, y una URL vieja que alguien guardó o compartió no
   * tiene por qué reventar la pantalla.
   */
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

export class TransitionCaseDto {
  @IsEnum(CaseStatus) status!: CaseStatus;
  @IsOptional() @IsString() reason?: string;
}

/**
 * Fijar la prioridad a mano, o devolverla a la automática.
 *
 * 🔴 **Existe porque el cálculo no puede saber todo.** La prioridad sale del saldo, los días de mora
 * y el segmento de riesgo — y eso está bien para el caso general. Falla justo en el que motivó esto:
 * un deudor con dos días de atraso cae en prioridad baja aunque quien lo conoce sepa que es moroso
 * frecuente y hay que ir hoy. Al revés pasa menos, pero pasa.
 *
 * Mientras esté fijada, **el trabajo diario no la recalcula**: es la misma regla que gobierna la
 * mora — cada dato tiene un dueño, y el de esta prioridad es la persona que la puso.
 */
export class SetPriorityDto {
  /** La prioridad elegida. Ausente con `auto: true`. */
  @IsOptional() @IsEnum(CasePriority) priority?: CasePriority;
  /** `true` = volver a la automática: se suelta y el job la recalcula en la próxima pasada. */
  @IsOptional() @IsBoolean() auto?: boolean;
}

export class AssignCaseDto {
  @IsOptional() @IsUUID() collectorId?: string;
  /** Asignación automática por menor carga. */
  @IsOptional() @IsBoolean() auto?: boolean;
}

/** Promesa de pago de una gestión (§5.4). Va ANTES de CreateActivityDto: emitDecoratorMetadata evalúa
 * `@Type(()=>X)` eager → ReferenceError (TDZ) si se declara después. */
export class ActivityPromiseDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsDateString() promiseDate!: string; // ISO YYYY-MM-DD
  @IsString() @IsNotEmpty() paymentMethodCode!: string;
  @IsOptional() @IsString() bankCode?: string;
}

export class CreateActivityDto {
  @IsEnum(CaseActivityType) type!: CaseActivityType;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() result?: string;
  /** Si viene, la gestión es una promesa: crea también un agenda_item PROMISE_TO_PAY (§5.4). */
  @IsOptional() @ValidateNested() @Type(() => ActivityPromiseDto) promise?: ActivityPromiseDto;
}

export class CloseCaseDto {
  @IsString() @IsNotEmpty() reason!: string;
}
