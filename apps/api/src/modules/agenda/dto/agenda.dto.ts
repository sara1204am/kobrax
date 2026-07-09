import { Type } from 'class-transformer';
import {
  IsDateString,
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
import { AgendaTimeSlot } from '@kobrax/shared';

/** Agendados de un día concreto (la pantalla principal). */
export class ListAgendaQueryDto {
  @IsDateString() date!: string; // YYYY-MM-DD
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
