import { IsString, Length, MinLength } from 'class-validator';

/**
 * Aceptar una invitación (CUENTA · S2). Endpoint **sin sesión**: este DTO es la única
 * frontera de confianza. El código llega como lo escribió la persona (con guiones,
 * espacios o minúsculas) y lo normaliza el service.
 *
 * La política de contraseña se valida server-side con `isPasswordValid` de
 * `@kobrax/shared`, igual que reset/change-password.
 */
export class AcceptInvitationDto {
  @IsString() @Length(8, 24) code!: string;
  @IsString() @MinLength(1) password!: string;
}
