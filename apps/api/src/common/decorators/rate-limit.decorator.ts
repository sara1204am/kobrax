import { SetMetadata } from '@nestjs/common';

/** Cómo se identifica al cliente para contar el límite. */
export type RateLimitBy = 'ip' | 'email' | 'email-ip';

export interface RateLimitConfig {
  /** Máximo de peticiones permitidas dentro de la ventana. */
  limit: number;
  /** Tamaño de la ventana en segundos. */
  windowSec: number;
  /** Identificador del cliente (por defecto IP). */
  by?: RateLimitBy;
}

export const RATE_LIMIT_KEY = 'rate_limit';

/**
 * Limita la tasa de un endpoint (ventana fija en Redis). Ej:
 *   `@RateLimit({ limit: 5, windowSec: 60, by: 'email-ip' })`
 */
export const RateLimit = (config: RateLimitConfig) => SetMetadata(RATE_LIMIT_KEY, config);
