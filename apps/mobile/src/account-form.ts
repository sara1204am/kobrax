/**
 * Lógica pura de los formularios de CUENTA S1: qué es válido y qué mandar.
 *
 * Sin red y sin React, como `cliente-form.ts`.
 *
 * ⚠️ **El diff se mudó a `@kobrax/shared`** (F9 · W2): la web edita los mismos campos contra
 * los mismos endpoints, y dos implementaciones se separan justo en el borde raro — quitar el
 * QR, que viaja como `null` y no como `''`. Acá se re-exporta para no tocar a quien ya lo
 * importaba de este archivo. Lo que sí se quedó son los **validadores**: devuelven mensajes en
 * español y el panel web es bilingüe.
 */
import {
  COUNTRY_CURRENCIES,
  ROLE_LABEL,
  isPasswordValid,
  type CurrencyCode,
  type RoleType,
} from '@kobrax/shared';

export {
  diffAccount,
  diffProfile,
  hasChanges,
  type AccountForm,
  type ProfileForm,
} from '@kobrax/shared';
import type { AccountForm, ProfileForm } from '@kobrax/shared';

/** País + moneda son un solo selector: acoplados en el producto (S1-D1). */
export interface CountryOption {
  /** ISO-3166 alpha-2, el valor que viaja como `countryCode`. */
  code: string;
  currency: CurrencyCode;
  label: string;
}

/** El rótulo es local: `shared` no lleva nombres de país porque la web los muestra en dos idiomas. */
const COUNTRY_NAME: Record<string, string> = {
  BO: 'Bolivia',
  CO: 'Colombia',
  MX: 'México',
  PE: 'Perú',
  AR: 'Argentina',
  US: 'Estados Unidos',
};

/** Los países salen de `shared` (la regla); acá sólo se les pone el rótulo en español. */
export const COUNTRY_OPTIONS: CountryOption[] = COUNTRY_CURRENCIES.map((c) => ({
  ...c,
  label: `${COUNTRY_NAME[c.code] ?? c.code} · ${c.symbol}`,
}));

export function findCountry(countryCode: string): CountryOption | undefined {
  return COUNTRY_OPTIONS.find((c) => c.code === countryCode);
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

/** Registro público (S4). País y moneda no se piden acá: arrancan en el default (S4-D8). */
export interface SignupForm {
  businessName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export function validateSignup(f: SignupForm): string | null {
  if (f.businessName.trim().length < 2) return 'El nombre del negocio es obligatorio';
  if (f.businessName.trim().length > 160) return 'El nombre del negocio es demasiado largo';
  if (f.firstName.trim().length < 1) return 'El nombre es obligatorio';
  if (f.lastName.trim().length < 1) return 'El apellido es obligatorio';
  // Misma forma mínima que valida `@IsEmail` del lado del server; el server manda igual.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'Correo inválido';
  // La política vive en shared: acá no se reescribe ninguna regla de contraseña.
  if (!isPasswordValid(f.password)) return 'La contraseña no cumple los requisitos';
  return null;
}

/** Invitar a un miembro (S2). El nombre lo pone quien invita (S2-D4). */
export interface InviteForm {
  firstName: string;
  lastName: string;
  email: string;
  roleId: string;
}

/**
 * Qué hace cada rol, en criollo. La **etiqueta** vive en `ROLE_LABEL` de shared (fuente
 * única con la web); esto es la explicación de una línea que va debajo, y es copy de la
 * app: quien invita no sabe qué es un "SUPERVISOR" hasta que se lo dicen así.
 */
const ROLE_HINT: Record<string, string> = {
  COLLECTOR: 'Cobra en campo: su cartera, sus rutas y sus pagos',
  SUPERVISOR: 'Supervisa cobradores y reparte cartera',
  ACCOUNT_ADMIN: 'Administra la cuenta, el equipo y los datos del negocio',
};

/** Opciones para el `PickerSheet` de rol. El recorte a 3 lo hace el servidor (`GET /roles`). */
export function roleOptions(
  roles: { id: string; name: string }[],
): { key: string; label: string; hint?: string }[] {
  return roles.map((r) => ({
    key: r.id,
    label: ROLE_LABEL[r.name as RoleType] ?? r.name,
    hint: ROLE_HINT[r.name],
  }));
}

export function validateInvite(f: InviteForm): string | null {
  if (f.firstName.trim().length < 1) return 'El nombre es obligatorio';
  if (f.lastName.trim().length < 1) return 'El apellido es obligatorio';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return 'Correo inválido';
  if (!f.roleId) return 'Elegí qué va a hacer en el equipo';
  return null;
}

// El diff (`diffAccount`, `diffProfile`, `hasChanges`) vive ahora en `@kobrax/shared` y se
// re-exporta arriba. Ver el encabezado del archivo.
