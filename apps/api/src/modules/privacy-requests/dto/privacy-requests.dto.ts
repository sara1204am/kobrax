import { IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PrivacyRequestStatus, PrivacyRequestType } from '@kobrax/shared';

/** Una persona usuaria presenta una solicitud sobre SUS datos. La persona sale de la sesión, nunca del cuerpo. */
export class CreateOwnPrivacyRequestDto {
  @IsEnum(PrivacyRequestType) type!: PrivacyRequestType;
  @IsString() @Length(10, 2000) description!: string;
}

/** El personal de una organización registra la solicitud de un titular de cobranza (la organización es la responsable). */
export class CreateOrgPrivacyRequestDto {
  @IsEnum(PrivacyRequestType) type!: PrivacyRequestType;
  /** Identificación mínima del titular: lo justo para ubicar su información (nombre y referencia). */
  @IsString() @Length(2, 200) subjectLabel!: string;
  @IsString() @Length(10, 2000) description!: string;
}

/** Cambio de estado. Rechazar exige `rejectionReason`; pedir información exige `note`. */
export class TransitionPrivacyRequestDto {
  @IsEnum(PrivacyRequestStatus) status!: PrivacyRequestStatus;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(1000) rejectionReason?: string;
}
