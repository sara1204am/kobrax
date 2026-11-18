import { IsEmail, IsEnum, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PrivacyRequestType } from '@kobrax/shared';

/** Lo que una persona SIN cuenta puede pedir por el formulario público. Lista cerrada: no hay forma de colar otro tipo. */
export const PUBLIC_REPORT_TYPES = [
  PrivacyRequestType.ABUSE_REPORT,
  PrivacyRequestType.ACCESS,
  PrivacyRequestType.RECTIFICATION,
  PrivacyRequestType.ERASURE,
  PrivacyRequestType.OBJECTION,
  PrivacyRequestType.ACCOUNT_DELETION,
  PrivacyRequestType.OTHER,
] as const;

export class CreatePublicReportDto {
  @IsEnum(PublicReportTypeEnum()) type!: PrivacyRequestType;
  @IsEmail() @MaxLength(200) contactEmail!: string;
  @IsOptional() @IsString() @Length(2, 120) contactName?: string;
  /** A qué organización, cobrador o cuenta se refiere (texto libre). */
  @IsOptional() @IsString() @MaxLength(200) reportedSubject?: string;
  @IsString() @Length(10, 2000) description!: string;
  /** Trampa para robots: un formulario real lo deja vacío (el campo va oculto). */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

function PublicReportTypeEnum(): Record<string, string> {
  return Object.fromEntries(PUBLIC_REPORT_TYPES.map((t) => [t, t]));
}
