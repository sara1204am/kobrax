import { Type } from 'class-transformer';
import { IsBase64, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';
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
}

export class AddEvidenceDto {
  @IsEnum(EvidenceType) type!: EvidenceType;
  @IsString() fileUrl!: string;
  @IsString() fileHash!: string;
  /** Contenido en base64 para verificación de integridad (en prod el server lo baja de S3). */
  @IsOptional() @IsBase64() content?: string;
}
