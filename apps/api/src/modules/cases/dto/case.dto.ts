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
  /**
   * Uno o **varios** separados por coma (`ACTIVE,PROMISE_TO_PAY`). Mandar uno solo se comporta como
   * siempre, que es lo que hace el móvil. Se validan en el service contra el enum y lo que no exista
   * se descarta: viaja en la URL, y un link viejo no puede tumbar la pantalla.
   */
  @IsOptional() @IsString() @MaxLength(200) status?: string;
  @IsOptional() @IsString() @MaxLength(120) priority?: string;
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
   * Búsqueda por **nombre del deudor o zona**.
   *
   * Al armar una ruta se busca de las dos maneras —«los Mamani» y «los del Centro»—, así que las dos
   * entran por la misma caja: el nombre palabra por palabra, la zona por coincidencia parcial.
   *
   * El documento y los teléfonos **no**: están cifrados y se buscan por blind index, que es otro
   * camino (el de la cartera).
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

  /*
   * ── Filtros para planificar rutas (W11) ──────────────────────────────────
   *
   * Todos **aditivos**: sin ellos el listado se comporta igual que siempre. Y todos como `@IsString`
   * suelto, con la validación real en el service: viajan en la URL de una pantalla con panel de
   * filtros, y un valor viejo de un link guardado tiene que caer al comportamiento por defecto en
   * vez de reventar la pantalla entera con un 400. Es el mismo criterio que ya tenía `sort`.
   */

  /** Zona del cliente (`client_locations.zone`). Texto libre: agrupa sólo si se escribió igual. */
  @IsOptional() @IsString() @MaxLength(60) zone?: string;

  /** Saldo del crédito, para priorizar por plata. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) balanceMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) balanceMax?: number;

  /** `'true'` = sólo con promesa vigente · `'false'` = sólo sin promesa. */
  @IsOptional() @IsIn(['true', 'false']) hasPromise?: string;

  /**
   * Ninguna visita **desde** esa fecha (`YYYY-MM-DD`). Incluye a los que no se visitaron nunca: si
   * no hay ninguna visita, tampoco hay ninguna reciente. Es «no vuelvas donde ya fuiste».
   */
  @IsOptional() @IsDateString() notVisitedSince?: string;
  /** `'true'` = **nunca** visitado, ni una vez. Es más estricto que `notVisitedSince`. */
  @IsOptional() @IsIn(['true', 'false']) neverVisited?: string;

  /**
   * Cómo terminó **alguna** visita anterior (`VisitOutcome`, uno o varios separados por coma).
   *
   * ⚠️ No es «el resultado de la última»: es «alguna vez terminó así». La diferencia importa —
   * alguien a quien no encontraron hace un mes y pagó la semana pasada entra igual en `NOT_FOUND`.
   * Filtrar por la última exigiría ordenar visitas por caso dentro de la consulta, y eso ya es SQL
   * crudo; se hace el día que esta versión moleste.
   */
  @IsOptional() @IsString() outcome?: string;

  /**
   * Excluye los casos que **ya son parada de una ruta ese día** (`YYYY-MM-DD`).
   *
   * Es el filtro «sólo mora disponible» de la planificación: sin él, dos supervisores mandan a dos
   * cobradores a la misma puerta el mismo día.
   */
  @IsOptional() @IsDateString() excludeRouted?: string;
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
