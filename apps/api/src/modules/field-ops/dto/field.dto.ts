import { Type } from 'class-transformer';
import {
  IsBase64,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { EvidenceType, VisitOutcome } from '@prisma/client';

export class CreateVisitDto {
  /** Opcional: lo genera el móvil para que reintentar (cola offline) no duplique la visita ni su gestión. */
  @IsOptional() @IsUUID() id?: string;
  /** El crédito visitado. Obligatorio salvo que se mande `routeStopId` (la parada trae el crédito). */
  @IsOptional() @IsUUID() creditId?: string;
  @IsOptional() @IsUUID() routeStopId?: string;
  @Type(() => Number) @IsNumber() lat!: number;
  @Type(() => Number) @IsNumber() lng!: number;
  @IsOptional() @Type(() => Number) @IsNumber() accuracy?: number;
  @IsEnum(VisitOutcome) outcome!: VisitOutcome;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsDateString() capturedAt?: string;

  /**
   * Campos propios de la variante (S5 · RT-6). La forma la decide `validateVisitDetails` de shared
   * contra el `outcome` — acá sólo se comprueba que sea un objeto.
   */
  @IsOptional() @IsObject() details?: Record<string, unknown>;

  /**
   * La coordenada no es una lectura del GPS sino la ubicación conocida de la parada (§5.4 del plan):
   * el cobrador registró sin permiso o sin señal. Se guarda marcado para que una auditoría no lo lea
   * como GPS real. Es un flag aparte y no parte de `details` porque aplica a todas las variantes.
   */
  @IsOptional() @IsBoolean() gpsFallback?: boolean;

  /** Desde dónde se registra: el móvil no manda nada (`MOBILE`); el panel manda `WEB`. Es informativo: la autoría la pone la API. */
  @IsOptional() @IsIn(['MOBILE', 'WEB']) source?: 'MOBILE' | 'WEB';

  /**
   * Una visita no se edita. Para corregir una ya registrada se manda una NUEVA con el id de la que corrige: queda como
   * nota sobre la original (no cuenta como otra gestión) y las dos se ven juntas.
   */
  @IsOptional() @IsUUID() correctsVisitId?: string;
}

/**
 * Filtros para leer visitas (F9 W6-T0). Antes no había forma de LEERLAS: el módulo tenía dos
 * endpoints y los dos escribían, así que la foto, el punto y el hash no eran alcanzables desde
 * ningún lado — y son justamente la prueba de que el cobrador estuvo ahí.
 */
export class ListVisitsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Todas las visitas de una ruta: se resuelve por las paradas de esa ruta. */
  @IsOptional() @IsUUID() routeId?: string;
  /** Las de UNA parada. Una parada puede tener más de una visita: se fue dos veces. */
  @IsOptional() @IsUUID() routeStopId?: string;
  @IsOptional() @IsUUID() creditId?: string;
  @IsOptional() @IsUUID() collectorId?: string;
  /** Un día concreto (`YYYY-MM-DD`), por `capturedAt`. */
  @IsOptional() @IsDateString() date?: string;
}

export class AddEvidenceDto {
  @IsEnum(EvidenceType) type!: EvidenceType;
  @IsString() fileUrl!: string;
  @IsString() fileHash!: string;
  /** Contenido en base64 para verificación de integridad (en prod el server lo baja de S3). */
  @IsOptional() @IsBase64() content?: string;
}
