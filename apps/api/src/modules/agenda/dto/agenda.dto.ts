import { Type } from 'class-transformer';
import {
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
} from 'class-validator';
import { AgendaItemType, ContactType, LocationType, ScheduleTimeMode } from '@prisma/client';
import { AGENDA_POSTPONE_STEPS, AgendaOutcome, AgendaTimeSlot } from '@kobrax/shared';

/**
 * Agendados de un día concreto (la pantalla principal). Mismo regex estricto que el alta: con
 * `@IsDateString` pasaba `2026-07-10T12:00:00Z`, y la hora sobrevivía al `new Date(...)` que se
 * compara por igualdad contra una columna `@db.Date` → cero filas en un día con agendados.
 */
export class ListAgendaQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date debe tener formato YYYY-MM-DD' })
  date!: string;
}

/** Vencidos (para la sección "máx 2 + ver más"). */
export class ListOverdueQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

/**
 * Alta de una gestión agendada. `clientId` y `assigneeId` los deriva el server (del caso y del
 * token) — nunca del body. `details` se valida contra el `type` con `validateAgendaDetails`.
 */
export class CreateAgendaItemDto {
  @IsUUID() caseId!: string;
  @IsUUID() creditId!: string;

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
 * (`plans/agenda/editar-eliminar.md` D5). Tampoco `caseId`/`creditId`/`clientId`: el deudor es el
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
}

/** Posponer una gestión en pasos fijos (Figma: +15 / +30 / +1h). */
export class PostponeAgendaItemDto {
  @Type(() => Number) @IsIn(AGENDA_POSTPONE_STEPS as unknown as number[]) minutes!: number;
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
}
