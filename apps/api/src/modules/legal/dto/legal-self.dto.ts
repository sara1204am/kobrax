import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/** Re-aceptación: los ids de las versiones vigentes que la pantalla mostró. El servidor valida que sigan siendo las vigentes. */
export class ReacceptDto {
  @IsOptional() @IsUUID() termsVersionId?: string;
  @IsOptional() @IsUUID() privacyVersionId?: string;
}

/** Otorgar (`true`) o retirar (`false`) un consentimiento opcional. */
export class ConsentDto {
  @IsBoolean() granted!: boolean;
}
