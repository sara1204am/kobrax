import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsTimeZone,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { ArrearsMethod, PREFERENCE_LOCALES, SUPPORTED_CURRENCIES, TIME_OF_DAY, WEEK_STARTS } from '@kobrax/shared';

const CURRENCIES = Object.keys(SUPPORTED_CURRENCIES);
/** Los países donde el producto opera salen del locale de cada moneda (`es-BO` → `BO`). */
const COUNTRIES = Object.values(SUPPORTED_CURRENCIES).map((c) => c.locale.split('-')[1]);

/**
 * Preferencias de trabajo (F5). Cada campo es opcional: el parche trae sólo lo que cambió y el service lo mezcla con lo
 * guardado. La coherencia del conjunto (fin después de inicio) la valida el service, que es quien ve el resultado.
 */
export class PreferencesDto {
  @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  workDays?: number[];
  @IsOptional() @Matches(TIME_OF_DAY, { message: 'workStart debe ser HH:MM' }) workStart?: string;
  @IsOptional() @Matches(TIME_OF_DAY, { message: 'workEnd debe ser HH:MM' }) workEnd?: string;
  @IsOptional() @IsIn([...WEEK_STARTS]) weekStart?: string;
  @IsOptional() @IsIn([...PREFERENCE_LOCALES]) defaultLocale?: string;
}

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
  // D20: cómo se cuenta la mora por defecto en los créditos nuevos de la cuenta.
  @IsOptional() @IsIn(Object.values(ArrearsMethod)) arrearsMethod?: string;

  // Identidad y contacto del negocio. Todos opcionales y **removibles**: `@IsOptional` deja pasar el `null`, que es la
  // forma de quitarlos (y `undefined` = no tocarlo).
  /**
   * Sólo una ruta que haya devuelto `/uploads` (`/api/uploads/<sha256>.<ext>`): el logo no es una URL cualquiera, no se
   * apunta a un sitio de afuera. Una ruta de otra cuenta no sirve de nada —el archivo se busca en la carpeta de quien
   * lo pide— y por eso alcanza con validar la forma.
   */
  @IsOptional() @Matches(/^\/api\/uploads\/[0-9a-f]{64}\.(jpg|png|webp)$/, { message: 'logoUrl debe ser un archivo subido' })
  logoUrl?: string | null;
  @IsOptional() @IsString() @Length(5, 32) phone?: string | null;
  @IsOptional() @IsEmail() @Length(3, 160) email?: string | null;
  @IsOptional() @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @Length(8, 200) website?: string | null;
  @IsOptional() @IsString() @Length(1, 240) address?: string | null;
  @IsOptional() @IsString() @Length(1, 80) city?: string | null;

  @IsOptional() @ValidateNested() @Type(() => PreferencesDto) preferences?: PreferencesDto;
}
