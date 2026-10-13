/**
 * Versión de la app móvil (`x-app-version`), tipo semver: `1.4.2`, `v1.4`, `1.4.2-beta.1`, `1.4.2+build7`.
 * Sólo cuenta el núcleo numérico `major.minor.patch`; lo que falte vale 0 y el sufijo se ignora.
 * Devuelve `null` si no se puede leer: quien llama decide (aquí, ante la duda se deja pasar).
 */
export function parseAppVersion(raw: string | undefined | null): [number, number, number] | null {
  if (typeof raw !== 'string') return null;
  const m = /^v?(\d{1,6})(?:\.(\d{1,6}))?(?:\.(\d{1,6}))?(?:[-+].*)?$/.exec(raw.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/** Negativo si `a < b`, 0 si iguales, positivo si `a > b`; `null` si alguna no se puede leer. */
export function compareAppVersions(a: string, b: string): number | null {
  const pa = parseAppVersion(a);
  const pb = parseAppVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! !== pb[i]!) return pa[i]! - pb[i]!;
  }
  return 0;
}

/**
 * D-5 · R5: primera versión de la app móvil que pide y manda el motivo al cerrar una ruta con paradas sin gestionar.
 * Hasta que se apruebe retirar la tolerancia (opción B, ver plan F10 «alineacion-web»), una app más vieja sigue pudiendo
 * cerrar sin motivo.
 */
export const ROUTE_CLOSE_REASON_MIN_APP_VERSION = '1.1.0';

export type LegacyClientReason = 'version_missing' | 'version_invalid' | 'version_below';

/**
 * ¿Es este un cliente al que todavía se le tolera la regla vieja? `null` = cliente al día: se le exige la regla completa.
 *
 * 🔴 **No es una puerta de seguridad.** El header lo manda el cliente y se puede omitir o mentir. Por eso solo decide una
 * regla *funcional y de auditoría* (un cobrador que cierra SU PROPIA ruta con paradas sin gestionar, sin motivo): autenticación,
 * permisos y alcance se resuelven antes y por otros medios, y nada de esto los afloja. Ausente, ilegible o menor a `since` →
 * se tolera (es lo que hoy ya pasa) y queda marcado en la auditoría para medir cuánta flota sigue viéndose así.
 */
export function legacyClientReason(raw: string | undefined | null, since: string): LegacyClientReason | null {
  if (raw === undefined || raw === null || raw.trim() === '') return 'version_missing';
  const cmp = compareAppVersions(raw, since);
  if (cmp === null) return 'version_invalid';
  return cmp < 0 ? 'version_below' : null;
}

/** `true` sólo si la versión del cliente se leyó, la mínima también, y la del cliente es menor. */
export function isBelowMinVersion(clientVersion: string | undefined | null, minVersion: string | undefined | null): boolean {
  if (!clientVersion || !minVersion) return false;
  const cmp = compareAppVersions(clientVersion, minVersion);
  return cmp !== null && cmp < 0;
}
