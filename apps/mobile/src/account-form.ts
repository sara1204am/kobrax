/**
 * Lógica pura de los formularios de CUENTA S1: qué es válido y qué mandar.
 *
 * Sin red y sin React, como `cliente-form.ts`. El diff es el corazón: la API corre con
 * `forbidNonWhitelisted: true`, así que mandar el objeto entero es un 400 — y además,
 * guardar sin tocar nada no debe disparar ni una llamada.
 *
 * Es la misma idea que `cliente-diff.ts`, no el mismo código: allá son sub-recursos con
 * altas y bajas por fila (`RowOps`); acá son campos escalares.
 */
import { SUPPORTED_CURRENCIES, type CurrencyCode } from '@kobrax/shared';
import type { AccountPatch, ProfilePatch } from './account.service';

/** País + moneda son un solo selector: acoplados en el producto (S1-D1). */
export interface CountryOption {
  /** ISO-3166 alpha-2, el valor que viaja como `countryCode`. */
  code: string;
  currency: CurrencyCode;
  label: string;
}

const COUNTRY_NAME: Record<string, string> = {
  BO: 'Bolivia',
  CO: 'Colombia',
  MX: 'México',
  PE: 'Perú',
  AR: 'Argentina',
  US: 'Estados Unidos',
};

/**
 * Las 6 combinaciones país+moneda que el producto soporta, derivadas de
 * `SUPPORTED_CURRENCIES` (su `locale` ya trae el país: `es-BO` → `BO`).
 * No se instala ninguna librería de países para un producto que opera en 6.
 */
export const COUNTRY_OPTIONS: CountryOption[] = Object.entries(SUPPORTED_CURRENCIES).map(
  ([currency, meta]) => {
    const code = meta.locale.split('-')[1]!;
    return {
      code,
      currency: currency as CurrencyCode,
      label: `${COUNTRY_NAME[code] ?? code} · ${meta.symbol}`,
    };
  },
);

export function findCountry(countryCode: string): CountryOption | undefined {
  return COUNTRY_OPTIONS.find((c) => c.code === countryCode);
}

export interface AccountForm {
  businessName: string;
  taxId: string;
  countryCode: string;
  currencyCode: string;
}

export interface ProfileForm {
  firstName: string;
  lastName: string;
  phone: string;
  photoUrl: string;
}

/** `null` = válido. El mensaje es el que se pinta bajo el campo. */
export function validateAccount(f: AccountForm): string | null {
  if (f.businessName.trim().length < 2) return 'El nombre del negocio es obligatorio';
  if (f.businessName.trim().length > 160) return 'El nombre es demasiado largo';
  if (f.taxId.trim().length > 40) return 'El NIT es demasiado largo';
  if (!findCountry(f.countryCode)) return 'Elegí un país';
  return null;
}

export function validateProfile(f: ProfileForm): string | null {
  if (f.firstName.trim().length < 1) return 'El nombre es obligatorio';
  if (f.lastName.trim().length < 1) return 'El apellido es obligatorio';
  const phone = f.phone.trim();
  // Sólo forma, no país: los teléfonos de LatAm varían y el server no los valida.
  if (phone && !/^[\d+][\d\s-]{4,}$/.test(phone)) return 'Teléfono inválido';
  return null;
}

/** Campos escalares que cambiaron, recortados. Vacío = no hay nada que guardar. */
function diffFields<T extends object>(before: T, after: T): Partial<T> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(after) as [string, string][]) {
    const a = value.trim();
    if (a !== ((before as Record<string, string>)[key] ?? '').trim()) out[key] = a;
  }
  return out as Partial<T>;
}

export function diffAccount(before: AccountForm, after: AccountForm): AccountPatch {
  return diffFields(before, after);
}

export function diffProfile(before: ProfileForm, after: ProfileForm): ProfilePatch {
  return diffFields(before, after);
}

export function hasChanges(patch: object): boolean {
  return Object.keys(patch).length > 0;
}
