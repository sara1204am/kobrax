import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * Alta de un miembro por invitación (S2). El nombre lo pone quien invita (S2-D4):
 * `Profile.firstName`/`lastName` son NOT NULL y así la lista muestra a la persona
 * desde el minuto cero en vez de un correo suelto. La contraseña la elige el invitado.
 */
export class InviteMemberDto {
  @IsString() @Length(1, 80) firstName!: string;
  @IsString() @Length(1, 80) lastName!: string;
  @IsEmail() email!: string;
  @IsUUID() roleId!: string;
}

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
