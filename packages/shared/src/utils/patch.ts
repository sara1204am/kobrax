/**
 * Qué mandar cuando se guarda un formulario: **sólo lo que cambió**.
 *
 * No es cosmética ni una optimización. La API corre con `forbidNonWhitelisted: true`: mandar
 * el objeto entero que devolvió el `GET` es un **400**. Y guardar sin haber tocado nada no
 * tiene que disparar ni una llamada.
 *
 * Vive en `shared` porque el móvil y la web editan los mismos campos contra los mismos
 * endpoints. Dos implementaciones se separan en el borde raro —el de abajo— y ahí la web
 * borraría un QR que el teléfono deja intacto.
 */
import type {
  AccountForm,
  AccountPatch,
  ProfileForm,
  ProfilePatch,
} from '../types/account.types.js';

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
  const patch: ProfilePatch = diffFields(before, after);
  // Vaciar el QR es QUITARLO, y eso viaja como `null`: el server distingue `null` (borrar) de
  // ausente (no tocar), y `''` no pasaría su validación de longitud.
  if (patch.paymentQrUrl === '') patch.paymentQrUrl = null;
  return patch;
}

export function hasChanges(patch: object): boolean {
  return Object.keys(patch).length > 0;
}
