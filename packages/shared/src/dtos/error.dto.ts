/** Estructura de error estándar de la API. */
export interface ErrorDto {
  code: string;
  message: string;
  details?: unknown;
}

/** Códigos de error internos (ver apps/api/CLAUDE.md). */
export const ERROR_CODES = {
  AUTH_INVALID_TOKEN: 'AUTH_001',
  AUTH_FORBIDDEN: 'AUTH_002',
  TENANT_MISMATCH: 'TENANT_001',
  CASE_CANNOT_CLOSE: 'CASE_001',
  CASE_INVALID_TRANSITION: 'CASE_002',
  PAYMENT_NEGATIVE_AMOUNT: 'PAYMENT_001',
  EVIDENCE_INVALID_HASH: 'EVIDENCE_001',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
