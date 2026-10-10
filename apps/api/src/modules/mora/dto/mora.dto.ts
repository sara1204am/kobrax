import { Type } from 'class-transformer';
import { IsBoolean, ValidateIf, ValidateNested } from 'class-validator';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  ARREARS_SOURCES,
  CREDIT_SOURCES,
  MORA_NOTE_COLORS,
  MORA_NOTE_KINDS,
  MORA_NOTE_MAX_LENGTH,
  NOTE_BOARD_LIMITS,
  MORA_NOTE_ANCHORS,
  RECOVERY_ACTIVITY_TYPES,
  type ArrearsSource,
  type CreditSource,
  type MoraNoteAnchor,
  type MoraNoteColor,
  type MoraNoteKind,
} from '@kobrax/shared';

/**
 * Filtros de `GET /mora`.
 *
 * Viajan en la URL de una pantalla con panel de filtros, así que **lo desconocido no rebota con 400**:
 * `sort`, `priority` y `category` son `@IsString` suelto y el service los valida. Un link guardado de cuando
 * había otro filtro tiene que abrir la lista (el pipe global es `forbidNonWhitelisted`, así que los filtros
 * que ya no existen se siguen ACEPTANDO y se ignoran).
 */
export class ListMoraQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;

  /** Nº de crédito, nombre del deudor (palabra por palabra) o zona. */
  @IsOptional() @IsString() @MaxLength(80) q?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMax?: number;
  /** `'true'` = incluye los créditos al día. Por defecto sólo `dpd >= 1`. */
  @IsOptional() @IsIn(['true', 'false']) todos?: string;

  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) balanceMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) balanceMax?: number;

  /** Prioridades del episodio de mora abierto, separadas por coma. */
  @IsOptional() @IsString() @MaxLength(120) priority?: string;
  /** Categorías de mora (códigos de la cuenta: `A`, `B,C`…), separadas por coma. Un código desconocido se ignora. */
  @IsOptional() @IsString() @MaxLength(120) category?: string;
  /** `'true'` = sólo castigados · `'false'` = sin los castigados. */
  @IsOptional() @IsIn(['true', 'false']) writtenOff?: string;
  /** Responsable del crédito: el principal o quien lo cubre (reemplazo temporal / apoyo vigentes). */
  @IsOptional() @IsUUID() assigneeId?: string;
  /** `'true'` = créditos sin responsable. */
  @IsOptional() @IsIn(['true', 'false']) unassigned?: string;
  @IsOptional() @IsUUID() branchId?: string;
  /** `KOBRAX` = sin fuente externa. */
  @IsOptional() @IsIn(CREDIT_SOURCES as unknown as string[]) source?: CreditSource;
  /** De dónde salen los días de mora: calculada, del archivo o marcada a mano. */
  @IsOptional() @IsIn(ARREARS_SOURCES as unknown as string[]) arrearsSource?: ArrearsSource;
  @IsOptional() @IsIn(['true', 'false']) hasPromise?: string;
  @IsOptional() @IsString() @MaxLength(60) zone?: string;

  /*
   * ── Filtros de planificación de rutas (por crédito: `field_visits.credit_id`, `route_stops.credit_id`) ──
   * Como todo filtro de esta lista, un valor que no se entiende se IGNORA (no es un 400).
   */

  /**
   * Excluye los créditos que ya son parada de una ruta NO cancelada de ese día. `'true'` = hoy (UTC);
   * `YYYY-MM-DD` = esa fecha (es lo que mandaba el filtro viejo de casos). Sin esto, dos supervisores mandan a
   * dos cobradores a la misma puerta el mismo día.
   */
  @IsOptional() @IsString() @MaxLength(10) excludeRouted?: string;
  /**
   * Cómo terminó la **última** visita de campo del crédito (`VisitOutcome`, uno o varios separados por coma).
   * ⚠️ Cambio respecto de los casos: allá era «alguna visita»; acá es la última (ahora hay SQL para ordenarlas).
   */
  @IsOptional() @IsString() @MaxLength(200) outcome?: string;
  /** `'true'` = nunca tuvo una visita de campo. */
  @IsOptional() @IsIn(['true', 'false']) neverVisited?: string;
  /**
   * Ninguna visita desde ese momento; incluye a los nunca visitados. Acepta `YYYY-MM-DD` (como el filtro viejo)
   * o un número de **días** hacia atrás (`30` = no visitado en los últimos 30 días).
   */
  @IsOptional() @IsString() @MaxLength(10) notVisitedSince?: string;

  /** Sin `@IsIn` a propósito: una clave desconocida cae al orden por defecto. */
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() dir?: string;
}

/**
 * Crear una nota de un crédito.
 *
 * `id` opcional: lo puede traer quien escribe (el móvil, sin red) y **reintentar con el mismo id no duplica**.
 * El largo se valida acá y también en la base (`credit_notes_largo`): una nota vacía no es una nota.
 */
export class CreateMoraNoteDto {
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @IsIn(MORA_NOTE_KINDS as unknown as string[]) kind?: MoraNoteKind;
  @IsString() @MinLength(1) @MaxLength(MORA_NOTE_MAX_LENGTH) body!: string;
  @IsOptional() @IsIn(MORA_NOTE_COLORS as unknown as string[]) color?: MoraNoteColor;
  /** Sección de la ficha en la que cae (`x`/`y` se miden desde ella). Sin ella, la ficha entera. */
  @IsOptional() @IsIn(MORA_NOTE_ANCHORS as unknown as string[]) anchor?: MoraNoteAnchor;
  /** Dónde cae en el tablero. Sin lugar, el servidor la pone en cascada. Se acota al tamaño permitido. */
  @IsOptional() @IsInt() @Min(0) @Max(100_000) x?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) y?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minWidth) @Max(NOTE_BOARD_LIMITS.maxWidth) w?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minHeight) @Max(NOTE_BOARD_LIMITS.maxHeight) h?: number;
}

/**
 * Editar una nota (PATCH): sólo lo que viene cambia.
 *
 * Cambiar el **texto o el tipo** es de quien la escribió o de quien reparte cartera; mover, redimensionar, pintar
 * o traer al frente lo puede quien pueda escribir sobre el crédito. El service lo hace cumplir.
 */
export class UpdateMoraNoteDto {
  @IsOptional() @IsIn(MORA_NOTE_KINDS as unknown as string[]) kind?: MoraNoteKind;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(MORA_NOTE_MAX_LENGTH) body?: string;
  @IsOptional() @IsIn(MORA_NOTE_COLORS as unknown as string[]) color?: MoraNoteColor;
  @IsOptional() @IsIn(MORA_NOTE_ANCHORS as unknown as string[]) anchor?: MoraNoteAnchor;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) x?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) y?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minWidth) @Max(NOTE_BOARD_LIMITS.maxWidth) w?: number;
  @IsOptional() @IsInt() @Min(NOTE_BOARD_LIMITS.minHeight) @Max(NOTE_BOARD_LIMITS.maxHeight) h?: number;
  /** Traerla al frente del tablero. */
  @IsOptional() @IsBoolean() front?: boolean;
}

/** Promesa de pago de una gestión. Va ANTES de CreateMoraActivityDto: emitDecoratorMetadata evalúa
 * `@Type(()=>X)` eager → ReferenceError (TDZ) si se declara después. */
export class ActivityPromiseDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() amount!: number;
  @IsDateString() promiseDate!: string; // ISO YYYY-MM-DD
  @IsString() @IsNotEmpty() paymentMethodCode!: string;
  @IsOptional() @IsString() bankCode?: string;
}

/**
 * Registrar una gestión sobre un crédito (`POST /mora/:creditId/activities`).
 *
 * El tipo y el resultado se validan acá sólo en su forma; **la regla de negocio** —qué resultado corresponde a
 * qué tipo, y que «promesa de pago» y la promesa van juntas— es `validateRecoveryActivity` de shared, que usa
 * también el panel.
 */
export class CreateMoraActivityDto {
  /** Lo puede poner el móvil (sin red): reintentar con el mismo id no duplica la gestión. */
  @IsOptional() @IsUUID() id?: string;
  @IsIn(RECOVERY_ACTIVITY_TYPES as unknown as string[]) type!: string;
  @IsOptional() @IsString() @MaxLength(40) result?: string;
  @IsOptional() @IsString() @MaxLength(MORA_NOTE_MAX_LENGTH + 200) notes?: string;
  @IsOptional() @ValidateNested() @Type(() => ActivityPromiseDto) promise?: ActivityPromiseDto;
  /**
   * Contexto de la gestión (F4/13 · E4). **Todo opcional**: una gestión anterior o encolada sin señal no lo trae. La regla
   * de fondo es `validateActivityContext` de shared (misma para el panel y el móvil).
   */
  @IsOptional() @IsString() @MaxLength(40) reasonCode?: string;
  @IsOptional() @IsString() @MaxLength(10) expectedIncomeDate?: string;
  @IsOptional() @IsString() @MaxLength(20) payerParty?: string;
  @IsOptional() @IsString() @MaxLength(20) origin?: string;
  /** Si viene, esa gestión agendada (SCHEDULED, del mismo crédito) se marca ejecutada con esta actividad, en la misma transacción. */
  @IsOptional() @IsUUID() agendaItemId?: string;
}

/**
 * Fijar la prioridad del episodio de mora abierto, o soltarla. `{ priority: 'HIGH' }` la fija a mano (el recálculo no
 * la pisa mientras esté fijada); `{ priority: null }` la suelta y vuelve la automática. Sin la clave → 400.
 */
export class SetMoraPriorityDto {
  @ValidateIf((o: SetMoraPriorityDto) => o.priority !== null)
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'])
  priority!: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
}
