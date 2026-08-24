import { IsIn, IsOptional, IsString, IsTimeZone, Length } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '@kobrax/shared';

const CURRENCIES = Object.keys(SUPPORTED_CURRENCIES);
/** Los países donde el producto opera salen del locale de cada moneda (`es-BO` → `BO`). */
const COUNTRIES = Object.values(SUPPORTED_CURRENCIES).map((c) => c.locale.split('-')[1]);

/**
 * Configuración editable del tenant. `planCode`, `limitsOverride`, `accountType` y `status`
 * NO están acá a propósito: no son configuración del producto.
 *
 * El `ValidationPipe` global corre con `forbidNonWhitelisted: true` → mandar cualquiera
 * de esos cuatro devuelve 400, no se ignora. El DTO es la guarda, y alcanza sola.
 */
export class UpdateAccountDto {
  @IsOptional() @IsString() @Length(2, 160) businessName?: string;
  @IsOptional() @IsString() @Length(1, 40) taxId?: string;
  @IsOptional() @IsIn(COUNTRIES) countryCode?: string;
  @IsOptional() @IsIn(CURRENCIES) currencyCode?: string;
  // IANA de verdad, no cualquier string: una zona basura guardada a mano hacía caer el reloj
  // del tenant a UTC en silencio — exactamente el bug que TenantClockService existe para evitar.
  @IsOptional() @IsTimeZone() timezone?: string;
  // String porque sale de un <select> y el diff de shared es de strings; el service lo numeriza
  // al guardarlo en settings.
  @IsOptional() @IsIn(['0', '1', '2']) currencyDecimals?: string;
}
