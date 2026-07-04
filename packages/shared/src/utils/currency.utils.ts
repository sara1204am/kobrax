/** Monedas soportadas (Latinoamérica + USD). */
export const SUPPORTED_CURRENCIES = {
  BOB: { name: 'Boliviano', symbol: 'Bs.', locale: 'es-BO' },
  COP: { name: 'Peso Colombiano', symbol: '$', locale: 'es-CO' },
  MXN: { name: 'Peso Mexicano', symbol: '$', locale: 'es-MX' },
  PEN: { name: 'Sol Peruano', symbol: 'S/', locale: 'es-PE' },
  ARS: { name: 'Peso Argentino', symbol: '$', locale: 'es-AR' },
  USD: { name: 'Dólar', symbol: '$', locale: 'en-US' },
} as const;

export type CurrencyCode = keyof typeof SUPPORTED_CURRENCIES;

/** Formatea un monto en la moneda indicada usando el locale correcto. */
export function formatCurrency(amount: number, currency: CurrencyCode): string {
  const { locale } = SUPPORTED_CURRENCIES[currency];
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
}
