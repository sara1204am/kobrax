import { createHash } from 'node:crypto';

/** Valida coordenadas GPS (rango WGS84). */
export function isValidGps(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** SHA-256 (hex) del contenido recibido en base64. */
export function sha256OfBase64(contentBase64: string): string {
  return createHash('sha256').update(Buffer.from(contentBase64, 'base64')).digest('hex');
}

/**
 * Verifica la integridad de la evidencia: el hash declarado debe coincidir con el
 * SHA-256 recalculado server-side del buffer original. En producción el server descarga
 * el archivo del object storage (S3/R2) y recalcula; aquí se acepta el contenido inline.
 */
export function verifyEvidenceHash(contentBase64: string, declaredHash: string): boolean {
  return sha256OfBase64(contentBase64) === declaredHash.trim().toLowerCase();
}
