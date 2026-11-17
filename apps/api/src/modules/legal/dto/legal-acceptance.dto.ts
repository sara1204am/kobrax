import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

/**
 * Lo que la persona aceptó al crear su acceso (registro o invitación). Se hereda en los DTO públicos.
 *
 * - `termsVersionId` / `privacyVersionId` son los ids de la versión que la pantalla le mostró. **Son opcionales a nivel de formato
 *   a propósito**: la falta de cualquiera la rechaza el servicio con `LEGAL_ACCEPTANCE_REQUIRED` (422, con un código que la pantalla
 *   entiende) y no con un `VALIDATION_ERROR` genérico. El servidor nunca confía en un hash o un texto enviado por el cliente.
 * - `marketingOptIn` / `analyticsOptIn` son consentimientos opcionales e independientes: ausentes o `false` = no consintió, y eso
 *   nunca bloquea el alta ni deja fila (no consentir no es un acto que haya que probar).
 */
export class LegalAcceptanceDto {
  @IsOptional() @IsUUID() termsVersionId?: string;
  @IsOptional() @IsUUID() privacyVersionId?: string;
  @IsOptional() @IsBoolean() marketingOptIn?: boolean;
  @IsOptional() @IsBoolean() analyticsOptIn?: boolean;
}
