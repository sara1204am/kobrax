import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '@kobrax/shared';

const CURRENCIES = Object.keys(SUPPORTED_CURRENCIES);
/** Los países donde el producto opera salen del locale de cada moneda (`es-BO` → `BO`). */
const COUNTRIES = Object.values(SUPPORTED_CURRENCIES).map((c) => c.locale.split('-')[1]);

/**
 * Configuración editable del tenant. `planCode`, `maxUsers`, `accountType` y `status`
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
  @IsOptional() @IsString() @Length(1, 64) timezone?: string;
}
