import { createHash } from 'node:crypto';

/** SHA-256 (hex) del texto en UTF-8. El mismo cálculo al publicar una versión y al comprobarla: demuestra qué texto se aceptó. */
export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** La versión vigente: la de `effectiveAt` más reciente que ya rige (`<= now`). Ante un empate manda la publicada después. */
export function pickCurrent<T extends { effectiveAt: Date; publishedAt: Date }>(
  versions: readonly T[],
  now: Date = new Date(),
): T | undefined {
  return versions
    .filter((v) => v.effectiveAt.getTime() <= now.getTime())
    .sort(
      (a, b) =>
        b.effectiveAt.getTime() - a.effectiveAt.getTime() ||
        b.publishedAt.getTime() - a.publishedAt.getTime(),
    )[0];
}

const MAX_USER_AGENT = 300;

/** Evidencia del request, minimizada: el user-agent se recorta y lo vacío queda `null` (no se guarda basura). */
export function cleanEvidence(e: { ip?: string; userAgent?: string; appVersion?: string }) {
  const clip = (v: string | undefined, max: number) => {
    const t = v?.trim();
    return t ? t.slice(0, max) : null;
  };
  return {
    ip: clip(e.ip, 64),
    userAgent: clip(e.userAgent, MAX_USER_AGENT),
    appVersion: clip(e.appVersion, 32),
  };
}

/**
 * El piso de una persona para un documento: la versión **más reciente que sea material** y ya rija; si ninguna lo es, la más antigua.
 * Quien aceptó una versión cuya vigencia es igual o posterior al piso está al día. Un cambio editorial (no material) NO obliga a
 * volver a aceptar; uno material sí. Quien nunca aceptó nada queda siempre por debajo del piso.
 */
export function requiredFloor<T extends { effectiveAt: Date; isMaterial: boolean }>(
  versions: readonly T[],
  now: Date = new Date(),
): T | undefined {
  const inForce = versions
    .filter((v) => v.effectiveAt.getTime() <= now.getTime())
    .sort((a, b) => b.effectiveAt.getTime() - a.effectiveAt.getTime());
  if (inForce.length === 0) return undefined;
  return inForce.find((v) => v.isMaterial) ?? inForce[inForce.length - 1];
}

/** ¿Alguna de las versiones aceptadas cubre el piso (vigencia igual o posterior)? */
export const isCovered = (floor: { effectiveAt: Date }, accepted: readonly { effectiveAt: Date }[]): boolean =>
  accepted.some((a) => a.effectiveAt.getTime() >= floor.effectiveAt.getTime());

/** El estado vigente de cada consentimiento: la última fila por finalidad (el historial no se reescribe, se lee el último). */
export function latestByPurpose<T extends { purpose: string; recordedAt: Date }>(rows: readonly T[]): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    const prev = out.get(r.purpose);
    if (!prev || r.recordedAt.getTime() >= prev.recordedAt.getTime()) out.set(r.purpose, r);
  }
  return out;
}
