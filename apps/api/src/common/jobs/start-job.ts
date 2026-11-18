import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type Redis from 'ioredis';

/** Identifica a ESTA instancia del servidor en el valor del candado (útil para depurar quién lo tiene). */
const INSTANCE_ID = randomUUID();

export interface JobOptions {
  /** Nombre estable del job: forma la clave del candado (`job:lock:<name>`). */
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
  /** Sin Redis (specs, desarrollo mínimo) el job corre siempre: igual que antes de existir el candado. */
  redis?: Redis;
  logger?: Logger;
}

/**
 * Programa una tarea de sistema periódica. Reemplaza al `setInterval(() => void this.run(), …)` que se repetía en cada servicio y
 * añade dos protecciones:
 *
 * - **Una sola instancia por ciclo:** con varias réplicas del API, la que llega primero toma un candado en Redis
 *   (`SET NX PX`, vence antes del siguiente ciclo) y las demás se saltan ese ciclo. Los jobs ya eran idempotentes; esto evita trabajo duplicado.
 *   Si Redis falla, el job corre igual (mejor duplicar que dejar de avisar).
 * - **Sin solaparse consigo mismo:** si un ciclo sigue corriendo cuando llega el siguiente, el segundo se omite.
 *
 * Devuelve el temporizador (con `unref`: no bloquea el apagado) para que el servicio lo limpie en `onModuleDestroy`.
 */
export function startJob(opts: JobOptions): NodeJS.Timeout {
  const { name, intervalMs, run, redis } = opts;
  const logger = opts.logger ?? new Logger(`Job:${name}`);
  let running = false;
  // El candado dura un poco menos que el ciclo: al siguiente tick ya está libre, pero otra instancia no lo toma dentro del mismo.
  const lockMs = Math.max(1_000, Math.floor(intervalMs * 0.9));

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      if (redis) {
        try {
          const got = await redis.set(`job:lock:${name}`, INSTANCE_ID, 'PX', lockMs, 'NX');
          if (got !== 'OK') return; // otra instancia lo está corriendo en este ciclo
        } catch (err) {
          logger.warn(`Sin candado en Redis para «${name}», se corre igual: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      await run();
    } catch (err) {
      logger.error(`El job «${name}» falló: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}
