import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Matches, Max, Min } from 'class-validator';

/** Códigos cortos y legibles: `CEN`, `ALTO-2`. Se guardan en mayúsculas. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;

/**
 * Alta de oficina. `parentId` y `typeId` son opcionales para no romper a quien todavía crea oficinas «planas»:
 * sin padre cuelga de la raíz; sin tipo, `AGENCIA`.
 */
export class CreateBranchDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @Matches(CODE, { message: 'code debe tener hasta 20 letras, números, guion o guion bajo' }) code?: string;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @IsString() @Length(1, 240) address?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 8 }) @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 8 }) @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @IsUUID() managerUserId?: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @IsUUID() typeId?: string;
}

/** Todo opcional y removible: `null` quita el dato, ausente no lo toca. Mover de lugar es `POST /branches/:id/move`. */
export class UpdateBranchDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @Matches(CODE, { message: 'code debe tener hasta 20 letras, números, guion o guion bajo' }) code?: string | null;
  @IsOptional() @IsString() @Length(1, 80) city?: string | null;
  @IsOptional() @IsString() @Length(1, 240) address?: string | null;
  /** El punto va completo o no va: `null` en las dos lo quita. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 8 }) @Min(-90) @Max(90) latitude?: number | null;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 8 }) @Min(-180) @Max(180) longitude?: number | null;
  @IsOptional() @IsUUID() managerUserId?: string | null;
  @IsOptional() @IsUUID() typeId?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class MoveBranchDto {
  @IsUUID() parentId!: string;
}

/**
 * Personas a asignar a la oficina. Por defecto MUEVE (comportamiento de siempre): si ya estaba en otra oficina se la
 * pasa a ésta. Con `mode: 'ADD'` pide una asignación ADICIONAL, que hoy se rechaza (409): una persona, una oficina.
 */
export class AssignMembersDto {
  /** Varias personas (1–100). Alternativa a `userId`. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) userIds?: string[];
  /** Una sola persona (forma singular). Alternativa a `userIds`; si vienen las dos se suman. */
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsIn(['MOVE', 'ADD']) mode?: 'MOVE' | 'ADD';
}

export class CreateBranchTypeDto {
  @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{0,39}$/, { message: 'code: mayúsculas, números, guion o guion bajo (hasta 40)' }) code!: string;
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}

export class UpdateBranchTypeDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
