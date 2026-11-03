import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/** Códigos cortos y legibles: `CEN`, `ALTO-2`. Se guardan en mayúsculas. */
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/;

export class CreateBranchDto {
  @IsString() @Length(2, 80) name!: string;
  @IsOptional() @Matches(CODE, { message: 'code debe tener hasta 20 letras, números, guion o guion bajo' }) code?: string;
  @IsOptional() @IsString() @Length(1, 80) city?: string;
  @IsOptional() @IsString() @Length(1, 240) address?: string;
  @IsOptional() @IsUUID() managerUserId?: string;
}

/** Todo opcional y removible: `null` quita el dato, ausente no lo toca. */
export class UpdateBranchDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @Matches(CODE, { message: 'code debe tener hasta 20 letras, números, guion o guion bajo' }) code?: string | null;
  @IsOptional() @IsString() @Length(1, 80) city?: string | null;
  @IsOptional() @IsString() @Length(1, 240) address?: string | null;
  @IsOptional() @IsUUID() managerUserId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class AssignMembersDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsUUID('all', { each: true }) userIds!: string[];
}
