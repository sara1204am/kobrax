import { Type } from 'class-transformer';
import { IsBase64, IsBoolean, IsDateString, IsEnum, IsNumber, IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { EvidenceType, VisitOutcome } from '@prisma/client';

export class CreateVisitDto {
  @IsOptional() @IsUUID() caseId?: string;
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
}

export class AddEvidenceDto {
  @IsEnum(EvidenceType) type!: EvidenceType;
  @IsString() fileUrl!: string;
  @IsString() fileHash!: string;
  /** Contenido en base64 para verificación de integridad (en prod el server lo baja de S3). */
  @IsOptional() @IsBase64() content?: string;
}
