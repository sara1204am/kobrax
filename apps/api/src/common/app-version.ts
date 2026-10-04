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

/** `true` sólo si la versión del cliente se leyó, la mínima también, y la del cliente es menor. */
export function isBelowMinVersion(clientVersion: string | undefined | null, minVersion: string | undefined | null): boolean {
  if (!clientVersion || !minVersion) return false;
  const cmp = compareAppVersions(clientVersion, minVersion);
  return cmp !== null && cmp < 0;
}
