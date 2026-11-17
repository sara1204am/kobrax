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
