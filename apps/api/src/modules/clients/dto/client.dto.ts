import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
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
  /** Cuelga el teléfono de un garante del cliente en vez del cliente mismo (misma tabla). */
  @IsOptional() @IsUUID() relationId?: string;
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
  /** Ídem `CreateContactDto`: la ubicación es del garante, no del cliente. */
  @IsOptional() @IsUUID() relationId?: string;
}

/** Corrección de una ubicación existente: todo opcional, se escribe sólo lo que viene. */
export class UpdateLocationDto {
  @IsOptional() @IsEnum(LocationType) locationType?: LocationType;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() zone?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() latitude?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() longitude?: number;
  @IsOptional() @IsString() referenceNotes?: string;
  /**
   * Las fotos de la fachada. **Faltaban acá**: el alta las aceptaba y la edición no, así que agregar
   * una foto a una dirección ya guardada devolvía 200 y no escribía nada. La lista viaja entera —es
   * el estado final, no un agregado—, igual que en las garantías.
   */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) photoUrls?: string[];
}

/**
 * A qué créditos del cliente respalda un garante o una garantía.
 *
 * 🔴 **La lista que llega REEMPLAZA a la anterior**, y por eso `[]` es un valor con significado:
 * «no respalda ninguno». Tratando el vacío como «no vino nada», desmarcar el último crédito no se
 * podría guardar nunca — la persona lo saca, guarda, vuelve, y sigue ahí.
 *
 * El tope es la defensa de siempre: son filas en una tabla puente, una por id.
 */
const CreditIds = () =>
  applyDecorators(IsOptional(), IsArray(), ArrayMaxSize(50), IsUUID(undefined, { each: true }));

/** Edición de un garante ya guardado: todo opcional. Sus teléfonos y ubicaciones van por su propia vía. */
export class UpdateRelationDto {
  @IsOptional() @IsString() @IsNotEmpty() relatedName?: string;
  @IsOptional() @IsEnum(RelationshipType) relationshipType?: RelationshipType;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsBoolean() isContactable?: boolean;
  @IsOptional() @IsString() notes?: string;
  @CreditIds() creditIds?: string[];
}

export class CreateRelationDto {
  @IsString() @IsNotEmpty() relatedName!: string;
  @IsEnum(RelationshipType) relationshipType!: RelationshipType;
  @IsOptional() @IsString() gender?: string;
  @IsOptional() @IsBoolean() isContactable?: boolean;
  @IsOptional() @IsString() notes?: string;
  /** El contacto (persona) tiene sus propios teléfonos y ubicaciones (1..N), en las tablas compartidas. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateContactDto) contacts?: CreateContactDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateLocationDto) locations?: CreateLocationDto[];
  @CreditIds() creditIds?: string[];
}

/**
 * Garantía **no personal**: el bien que respalda el crédito (la personal es el garante).
 *
 * Cuelga del cliente y se ata a N créditos: el mismo vehículo puede respaldar los dos créditos del
 * deudor, y atado a uno solo habría que cargarlo y fotografiarlo dos veces.
 */
export class CreateCollateralDto {
  /** Código del catálogo `COLLATERAL_TYPE` del tenant. Texto suelto: cada empresa arma su lista. */
  @IsOptional() @IsString() @MaxLength(64) type?: string;
  @IsString() @IsNotEmpty() @MaxLength(500) description!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) estimatedValue?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) photoUrls?: string[];
  @CreditIds() creditIds?: string[];
}

export class UpdateCollateralDto {
  @IsOptional() @IsString() @MaxLength(64) type?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(500) description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) estimatedValue?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) photoUrls?: string[];
  @CreditIds() creditIds?: string[];
}

// ── Cliente ──────────────────────────────────────────────────────────────────
export class CreateClientDto {
  /**
   * Id propuesto por el cliente (móvil). **Es lo que hace el alta idempotente**: el cobrador da de
   * alta a un deudor sin señal, la acción queda en cola y si se reintenta, el server reconoce que
   * esa alta ya entró en vez de crear un segundo cliente. Opcional: la web no lo manda y el server
   * genera el suyo.
   */
  @IsOptional() @IsUUID() id?: string;

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
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateCollateralDto) collaterals?: CreateCollateralDto[];
}

/** Todos los campos opcionales (no extiende PartialType para no depender de mapped-types). */
export class UpdateClientDto {
  /**
   * 🔴 **Faltaba, y el `forbidNonWhitelisted` del pipe global lo convertía en un 400.** El formulario
   * de edición ofrece el desplegable Persona/Empresa: cambiarlo hacía que **todo el guardado**
   * —nombre, riesgo, estado— rebotara con «property clientType should not exist», en inglés y sin
   * decir cuál de los nueve campos era. Un cliente importado como persona siendo empresa no tenía
   * arreglo. El servicio valida la identidad **contra el tipo que queda**, no contra el que había.
   */
  @IsOptional() @IsEnum(ClientType) clientType?: ClientType;
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

/** Criterios de orden de la cartera. `dpd` (mora) es el default y el que abre la pantalla. */
export const CLIENT_SORTS = ['dpd', 'debt', 'name', 'status', 'createdAt'] as const;
export type ClientSort = (typeof CLIENT_SORTS)[number];

export class ListClientsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** Búsqueda: documento exacto (vía hash) o nombre (ILIKE). */
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsEnum(ClientStatus) status?: ClientStatus;
  @IsOptional() @IsString() risk?: string;
  /**
   * Filtros sobre los AGREGADOS de la cartera (`view=portfolio`). Sólo tienen sentido ahí: sin la
   * vista no hay suma ni máximo que filtrar.
   *
   * 🔴 **Van a `HAVING`, no a `WHERE`.** `mora > 90` significa «la peor mora de esta PERSONA pasa de
   * 90», no «tiene algún crédito con más de 90». En el `WHERE` sobre créditos, alguien con un
   * crédito de 400 días y otro al día entraría igual, pero su fila mostraría la mora agregada —y el
   * resultado no coincidiría con el filtro que la persona escribió.
   */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) debtMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) debtMax?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) dpdMax?: number;
  /** Cuántos créditos activos tiene. `4` en la pantalla significa «4 o más» (`creditsMin=4`). */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) creditsMin?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) creditsMax?: number;
  /** La sucursal es del CRÉDITO, no del cliente. */
  @IsOptional() @IsUUID() branchId?: string;
  /**
   * El cobrador **no está en el cliente ni en el crédito**: es `collection_cases.assignee_id`. Por
   * eso filtra con un `EXISTS` sobre casos y no con una columna.
   */
  @IsOptional() @IsUUID() collectorId?: string;
  /**
   * `portfolio` → cada cliente viene con su deuda agregada, su peor mora y cuántos créditos tiene,
   * y **la lista se puede ordenar por eso**. Es la cartera del panel web (F9 · W3).
   */
  @IsOptional() @IsIn(['portfolio']) view?: 'portfolio';
  /**
   * ⚠️ **Sólo con `view=portfolio`.** `debt` y `dpd` se calculan agregando los créditos, así que
   * ordenar por ellos es parte de la misma consulta: sin la vista no hay nada que ordenar. La lista
   * de siempre sigue saliendo por fecha de alta.
   */
  @IsOptional() @IsIn(CLIENT_SORTS) sort?: ClientSort;
  @IsOptional() @IsIn(['asc', 'desc']) dir?: 'asc' | 'desc';
}

/** La bitácora del cliente: paginada, sin filtros. Se mira de lo último hacia atrás. */
export class TimelineQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
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

/**
 * Lo único que se corrige de un adjunto ya subido: **qué es**.
 *
 * El archivo no se toca —su hash es lo que prueba que no cambió—, así que reemplazarlo es subir otro
 * y borrar éste. Clasificarlo mal, en cambio, pasa siempre: se sube el carnet apurado y queda como
 * «Otro», y después nadie encuentra el carnet.
 */
export class UpdateAttachmentDto {
  @IsEnum(AttachmentType) fileType!: AttachmentType;
}
