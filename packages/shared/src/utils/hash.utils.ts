/**
 * SHA-256 isomórfico (Node 20+, navegador y React Native con polyfill de
 * crypto.subtle). Se usa para sellar la evidencia de campo (foto/firma) y
 * verificar su integridad en el servidor antes de persistir.
 */
export async function sha256(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const buffer =
    typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer as BufferSource);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Compara dos hashes en tiempo constante (evita timing attacks). */
export function hashEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
