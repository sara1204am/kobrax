/** Constantes globales de la aplicación. */
export const KOBRAX = {
  API_VERSION: '1',
  /** bcrypt work factor para hashing de contraseñas. */
  BCRYPT_WORK_FACTOR: 12,
  /** Vida de tokens. */
  ACCESS_TOKEN_TTL: '15m',
  REFRESH_TOKEN_TTL: '7d',
  /** Bloqueo de cuenta tras N intentos fallidos. */
  MAX_FAILED_LOGINS: 5,
  ACCOUNT_LOCK_MINUTES: 15,
  /** Mobile. */
  EVIDENCE_MAX_PHOTO_KB: 800,
  SESSION_TIMEOUT_HOURS: 8,
  SYNC_INTERVAL_SECONDS: 30,
} as const;

/**
 * Medios de pago (`payments.method`).
 *
 * 🔴 **En MAYÚSCULA porque así los guarda y los espera la API**: es el enum `PaymentMethod` de
 * Prisma. Hasta W7 esta lista estaba en minúscula y mandarla **hacía rebotar el pago** — el delta
 * C7 del BUILD-PLAN. Sobrevivió seis etapas porque nadie la usaba: el móvil se escribió su propia
 * copia al lado y la API leía la de Prisma. Ahora hay una sola verdad, y es ésta.
 */
export const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'QR', 'CARD', 'MOBILE_PAYMENT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
