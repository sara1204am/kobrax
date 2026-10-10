import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { AgendaItemType, ContactType, LocationType, ScheduleTimeMode } from '@prisma/client';
import { AGENDA_POSTPONE_STEPS, AgendaOutcome, AgendaTimeSlot } from '@kobrax/shared';

/**
 * Agendados de un día concreto (la pantalla principal). Mismo regex estricto que el alta: con
 * `@IsDateString` pasaba `2026-07-10T12:00:00Z`, y la hora sobrevivía al `new Date(...)` que se
 * compara por igualdad contra una columna `@db.Date` → cero filas en un día con agendados.
 */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un día, o un rango.
 *
 * 🔴 **`date` dejó de ser obligatorio, y `from`/`to` sólo valen juntos.** El rango es para la tira
 * semanal y el calendario del mes: pintar cuántas gestiones tiene cada día es una pregunta por 7 o
 * por 31 días, y de a un día serían 31 llamadas para dibujar una grilla. Mandar `from` sin `to`
 * pediría «desde el lunes hasta siempre», así que se piden los dos o ninguno.
 */
export class ListAgendaQueryDto {
  @IsOptional() @Matches(ISO_DAY, { message: 'date debe tener formato YYYY-MM-DD' })
  date?: string;

  @ValidateIf((o: ListAgendaQueryDto) => o.to !== undefined)
  @Matches(ISO_DAY, { message: 'from debe tener formato YYYY-MM-DD' })
  from?: string;

  @ValidateIf((o: ListAgendaQueryDto) => o.from !== undefined)
  @Matches(ISO_DAY, { message: 'to debe tener formato YYYY-MM-DD' })
  to?: string;
}

/** Vencidos (para la sección "máx 2 + ver más"). */
export class ListOverdueQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/**
 * Alta de una gestión agendada. `clientId` y `assigneeId` los deriva el server (del crédito y del
 * token) — nunca del body. `details` se valida contra el `type` con `validateAgendaDetails`.
 */
export class CreateAgendaItemDto {
  /** Opcional: lo genera el móvil para que reintentar (cola offline) no duplique la gestión ni su recordatorio. */
  @IsOptional() @IsUUID() id?: string;
  @IsUUID() creditId!: string;

  /**
   * A quién se le asigna. Sin él, la gestión queda para el responsable del crédito (o para quien agenda).
   * Solo lo acepta quien tiene `agenda:assign` (supervisor, gerente, administrador); un cobrador solo puede
   * mandar su propio id. El destinatario se valida en el servidor.
   */
  @IsOptional() @IsUUID() assigneeId?: string;

  @IsEnum(AgendaItemType) type!: AgendaItemType;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate debe tener formato YYYY-MM-DD' })
  scheduledDate!: string;

  // `RANGE` existe en el enum pero queda fuera del núcleo (ver plans/agenda/crear.md §3).
  @IsIn([ScheduleTimeMode.FIXED, ScheduleTimeMode.LAPSE]) timeMode!: ScheduleTimeMode;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledTime debe tener formato HH:mm' })
  scheduledTime?: string;

  @IsOptional() @IsEnum(AgendaTimeSlot) timeSlot?: AgendaTimeSlot;

  @IsOptional() @IsString() @MaxLength(1000) observations?: string;

  @IsObject() details!: Record<string, unknown>;
}

/**
 * Editar una gestión pendiente (S5). Todo opcional: se manda sólo lo que cambia.
 *
 * **No lleva `scheduledDate`** a propósito: mover el día es *reagendar* y deja rastro
 * (`plans/agenda/editar-eliminar.md` D5). Tampoco `creditId`/`clientId`: el deudor es el
 * ancla del agendado y no se cambia editando (D1).
 */
export class UpdateAgendaItemDto {
  @IsOptional() @IsEnum(AgendaItemType) type?: AgendaItemType;

  @IsOptional() @IsIn([ScheduleTimeMode.FIXED, ScheduleTimeMode.LAPSE]) timeMode?: ScheduleTimeMode;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledTime debe tener formato HH:mm' })
  scheduledTime?: string;

  @IsOptional() @IsEnum(AgendaTimeSlot) timeSlot?: AgendaTimeSlot;

  @IsOptional() @IsString() @MaxLength(1000) observations?: string;

  @IsOptional() @IsObject() details?: Record<string, unknown>;

  /**
   * Reasignar la gestión a otra persona (F4/11 · E5). Solo quien la creó, y la misma regla del alta: con `agenda:assign` a un
   * cobrador o supervisor activo de su alcance; sin él, solo a uno mismo.
   */
  @IsOptional() @IsUUID() assigneeId?: string;
}

/** Cancelar una gestión (S6). El motivo sale del catálogo `CANCEL_REASON` del tenant. */
export class CancelAgendaItemDto {
  @IsString() @IsNotEmpty() @MaxLength(50) reasonCode!: string;
}

/**
 * Reagendar a otro día (S6): cierra la original como `RESCHEDULED` y crea una nueva. El motivo sale
 * del catálogo `RESCHEDULE_REASON`. `type`/`details`/observaciones se copian: reagendar no es editar.
 */
export class RescheduleAgendaItemDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate debe tener formato YYYY-MM-DD' })
  scheduledDate!: string;

  @IsIn([ScheduleTimeMode.FIXED, ScheduleTimeMode.LAPSE]) timeMode!: ScheduleTimeMode;

  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledTime debe tener formato HH:mm' })
  scheduledTime?: string;

  @IsOptional() @IsEnum(AgendaTimeSlot) timeSlot?: AgendaTimeSlot;

  @IsString() @IsNotEmpty() @MaxLength(50) reasonCode!: string;
}

/**
 * Registrar la ejecución de una gestión (S4). `outcome` se valida contra el tipo en el servicio
 * (`AGENDA_OUTCOMES_BY_TYPE`) — acá solo se comprueba que sea un valor del enum.
 */
export class CompleteAgendaItemDto {
  @IsEnum(AgendaOutcome) outcome!: AgendaOutcome;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  /**
   * Contexto de la gestión (F4/13 · E4), el mismo que en `POST /mora/:id/activities`. Todo opcional. La regla de fondo es
   * `validateActivityContext` de shared.
   */
  @IsOptional() @IsString() @MaxLength(40) reasonCode?: string;
  @IsOptional() @IsString() @MaxLength(10) expectedIncomeDate?: string;
  @IsOptional() @IsString() @MaxLength(20) payerParty?: string;
  @IsOptional() @IsString() @MaxLength(20) origin?: string;
}

/** Posponer una gestión en pasos fijos (Figma: +15 / +30 / +1h). */
export class PostponeAgendaItemDto {
  /** Relativa (clientes viejos). No es idempotente: cada envío corre la hora otro tanto. */
  @IsOptional() @Type(() => Number) @IsIn(AGENDA_POSTPONE_STEPS as unknown as number[]) minutes?: number;

  /** Absoluta `HH:mm` (idempotente: la gestión QUEDA a esa hora). Si vienen las dos, manda esta. */
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'toTime debe tener formato HH:mm' })
  toTime?: string;
}

/**
 * Teléfono nuevo cargado desde el formulario de agendar. Sólo canales telefónicos: el email no sirve
 * para una llamada ni un WhatsApp, y este endpoint no es un ABM de contactos.
 */
export class AddClientContactDto {
  @IsIn([ContactType.PHONE, ContactType.WHATSAPP]) contactType!: ContactType;

  // Formato libre a propósito: los planes de numeración de LatAm varían por país.
  @IsString() @IsNotEmpty() @MaxLength(30) value!: string;

  /** Etiqueta del número ("Celular", "Trabajo", "Referencia"). */
  @IsOptional() @IsString() @MaxLength(100) notes?: string;
}

/**
 * Dirección nueva cargada desde el formulario de agendar una visita. `latitude`/`longitude` son
 * opcionales: el cobrador puede cargar la dirección sin marcar el punto en el mapa.
 */
export class AddClientLocationDto {
  @IsEnum(LocationType) locationType!: LocationType;

  @IsString() @IsNotEmpty() @MaxLength(200) address!: string;

  @IsOptional() @IsString() @MaxLength(100) zone?: string;

  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;

  /** Referencia para encontrarla ("portón verde, frente a la cancha"). */
  @IsOptional() @IsString() @MaxLength(200) referenceNotes?: string;

  /** Fotos de la vivienda para reconocerla; **la primera es la principal** (la que se ve chica en los mapas). */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) photoUrls?: string[];
}
