import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** `POST /assignments/temporary` — un reemplazo temporal: vence sí o sí. */
export class CreateTemporaryAssignmentDto {
  @IsUUID() creditId!: string;
  /** Quién cubre. */
  @IsUUID() userId!: string;
  /** ISO, futuro. */
  @IsDateString() expiresAt!: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** `POST /assignments/support` — la ayuda: un segundo cobrador. Sin vencimiento salvo que se pida. */
export class CreateSupportAssignmentDto {
  @IsUUID() creditId!: string;
  @IsUUID() userId!: string;
  @IsOptional() @IsDateString() expiresAt?: string;
}
