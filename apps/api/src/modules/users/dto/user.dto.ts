import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/** Lo único que el móvil administra de una membresía: su rol y si está activa. */
export class UpdateMemberDto {
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** El propio perfil. `email` no está: cambiarlo es cambiar la identidad de login. */
export class UpdateProfileDto {
  @IsOptional() @IsString() @Length(1, 80) firstName?: string;
  @IsOptional() @IsString() @Length(1, 80) lastName?: string;
  @IsOptional() @IsString() @Length(5, 32) phone?: string;
  @IsOptional() @IsString() @Length(1, 500) photoUrl?: string;
}
