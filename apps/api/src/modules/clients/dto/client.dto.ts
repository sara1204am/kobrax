import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AttachmentType,
  ClientStatus,
  ClientType,
  ContactType,
  LocationType,
  RelationshipType,
} from '@prisma/client';

// ── Sub-recursos (declarados antes de CreateClientDto: `emitDecoratorMetadata` evalúa el tipo eager) ──
export class CreateContactDto {
  @IsEnum(ContactType) contactType!: ContactType;
  @IsString() @IsNotEmpty() value!: string; // se cifra en reposo
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class CreateLocationDto {
  @IsOptional() @IsEnum(LocationType) locationType?: LocationType;
  @IsOptional() @IsString() address?: string; // se cifra en reposo
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @Type(() => Number) latitude?: number;
  @IsOptional() @Type(() => Number) longitude?: number;
  @IsOptional() @IsString() referenceNotes?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) photoUrls?: string[];
  @IsOptional() @IsObject() visitSchedule?: Record<string, unknown>;
  @IsOptional() @IsString() riskLevel?: string;
}

export class CreateRelationDto {
  @IsString() @IsNotEmpty() relatedName!: string;
  @IsEnum(RelationshipType) relationshipType!: RelationshipType;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsBoolean() isContactable?: boolean;
  @IsOptional() @IsString() notes?: string;
}

// ── Cliente ──────────────────────────────────────────────────────────────────
export class CreateClientDto {
  @IsEnum(ClientType)
  clientType!: ClientType;

  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() gender?: string;
  /** Documento (CI/NIT). Se cifra en reposo y se indexa por blind index. */
  @IsOptional() @IsString() nationalId?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @IsString() preferredContactChannel?: string;
  @IsOptional() @IsString() riskSegment?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
  /** Alta atómica (§5.1): contactos, ubicaciones y relaciones creados en la misma transacción. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateContactDto) contacts?: CreateContactDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateLocationDto) locations?: CreateLocationDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateRelationDto) relations?: CreateRelationDto[];
}

/** Todos los campos opcionales (no extiende PartialType para no depender de mapped-types). */
export class UpdateClientDto {
  @IsOptional() @IsString() firstName?: string;
  @IsOptional() @IsString() lastName?: string;
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsString() nationalId?: string;
  @IsOptional() @IsString() taxId?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @IsString() preferredContactChannel?: string;
  @IsOptional() @IsString() riskSegment?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class ListClientsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Búsqueda: documento exacto (vía hash) o nombre (ILIKE). */
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @IsString() risk?: string;
}

// ── Sub-recursos ─────────────────────────────────────────────────────────────
export class UpdateContactDto {
  @IsOptional() @IsEnum(ContactType) contactType?: ContactType;
  @IsOptional() @IsString() value?: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
  @IsOptional() @IsBoolean() isVerified?: boolean;
  @IsOptional() @IsString() notes?: string;
}

export class CreateAttachmentDto {
  @IsEnum(AttachmentType) fileType!: AttachmentType;
  @IsString() @IsNotEmpty() fileUrl!: string;
  @IsOptional() @IsString() fileHash?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}
