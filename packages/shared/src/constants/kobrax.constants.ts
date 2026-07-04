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

/** Métodos de pago soportados (tabla payment.method). */
export const PAYMENT_METHODS = ['cash', 'transfer', 'qr', 'card', 'mobile_payment'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
