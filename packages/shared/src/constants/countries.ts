import { SUPPORTED_CURRENCIES, type CurrencyCode } from '../utils/currency.utils.js';

/** Un país del mercado, con la moneda que le corresponde. */
export interface CountryCurrency {
  /** ISO-3166 alpha-2, el valor que viaja como `countryCode`. */
  code: string;
  currency: CurrencyCode;
  symbol: string;
}

/**
 * Los países que el producto soporta, **con su moneda acoplada**: país y moneda son un solo
 * selector (decisión S1-D1 del móvil), así que no se pueden combinar mal.
 *
 * Se derivan de `SUPPORTED_CURRENCIES` —su `locale` ya trae el país (`es-BO` → `BO`)— en vez
 * de mantener una segunda lista al lado. No se instala ninguna librería de países para un
 * producto que opera en seis.
 *
 * **Sin el nombre del país a propósito**: sería una cadena en un idioma, y el panel web es
 * bilingüe. Cada plataforma lo rotula — la web con `Intl.DisplayNames`, que ya trae el
 * navegador.
 */
export const COUNTRY_CURRENCIES: CountryCurrency[] = Object.entries(SUPPORTED_CURRENCIES).map(
  ([currency, meta]) => ({
    code: meta.locale.split('-')[1]!,
    currency: currency as CurrencyCode,
    symbol: meta.symbol,
  }),
);
