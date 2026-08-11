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

/**
 * Campos escalares que cambiaron, recortados. Vacío = no hay nada que guardar.
 *
 * **Vaciar un campo es QUITARLO, y eso viaja como `null`.** No es un detalle de estilo: los
 * campos opcionales de la API se validan con `@IsOptional() @Length(1, n)`, y `@IsOptional`
 * saltea la validación cuando el valor es `null` o `undefined` — pero `''` no es ninguno de
 * los dos, así que choca contra el `@Length` y **rechaza el PATCH entero**. O sea que borrar
 * el NIT o el teléfono devolvía un 400 y se perdían de paso los otros cambios de la misma
 * tanda.
 */
function diffFields<T extends object>(before: T, after: T): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(after) as [string, string][]) {
    const now = value.trim();
    if (now === ((before as Record<string, string>)[key] ?? '').trim()) continue;
    out[key] = now === '' ? null : now;
  }
  return out;
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
