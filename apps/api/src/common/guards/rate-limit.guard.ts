import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { REDIS } from '../../redis/redis.module';
import { RATE_LIMIT_KEY, type RateLimitConfig } from '../decorators/rate-limit.decorator';

/**
 * Límite global de borde. Los endpoints sensibles lo endurecen con @RateLimit.
 *
 * 🔴 **El techo se cuenta en pantallas, no en clics.** El tablero pide 9 endpoints por render y se
 * refresca en cada guardado: un solo arrastre son ~10 peticiones. Con 100 alcanzaba para diez
 * arrastres por minuto y después la pantalla decía que no se podía guardar.
 */
const GLOBAL_LIMIT = 600;
const GLOBAL_WINDOW = 60;

/**
 * Rate limiting de ventana fija sobre Redis. Se registra como guard global:
 * aplica el límite global por IP a todo y, si el handler lleva `@RateLimit`,
 * añade un límite más estricto (por IP / email / email+IP). Responde 429.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path ?? '';
    // Las sondas de salud no se limitan (liveness/readiness).
    if (path.includes('/health')) return true;

    const ip = req.ip ?? 'unknown';
    // La clave del límite por endpoint sale del HANDLER, no de `req.path`. Con la URL
    // concreta, una ruta con parámetro (`/auth/invitation/:code`) le daba a cada valor su
    // propio cubo: 10 intentos POR CÓDIGO en vez de 10 por IP, o sea ningún límite útil.
    const route = `${context.getClass().name}.${context.getHandler().name}`;
    await this.enforce(`rl:global:${this.caller(req, ip)}`, GLOBAL_LIMIT, GLOBAL_WINDOW);

    const cfg = this.reflector.get<RateLimitConfig>(RATE_LIMIT_KEY, context.getHandler());
    if (cfg) {
      await this.enforce(`rl:${route}:${this.identifier(cfg.by ?? 'ip', req, ip)}`, cfg.limit, cfg.windowSec);
    }
    return true;
  }

  /**
   * A quién se le cuenta el límite global.
   *
   * 🔴 **La IP no distingue a nadie.** El panel web habla con la API desde su propio servidor (el
   * BFF), así que todas las peticiones de todos los usuarios llegan con la misma IP: una sola cubeta
   * de N por minuto para la empresa entera, y el que estaba moviendo widgets dejaba sin cupo al que
   * recién abría la pantalla. Cuando hay sesión, la cubeta es del token; si no —login, registro,
   * invitación—, sigue siendo la IP, que es justo donde importa para la fuerza bruta.
   *
   * El token va hasheado: la clave vive en Redis y un token en claro ahí es un token robable.
   */
  private caller(req: Request, ip: string): string {
    const auth = req.headers.authorization;
    if (!auth) return `ip:${ip}`;
    return `t:${createHash('sha256').update(auth).digest('hex').slice(0, 32)}`;
  }

  private identifier(by: NonNullable<RateLimitConfig['by']>, req: Request, ip: string): string {
    const email = String((req.body as { email?: string })?.email ?? 'noemail').toLowerCase();
    if (by === 'email') return email;
    if (by === 'email-ip') return `${email}|${ip}`;
    return ip;
  }

  /** INCR + EXPIRE en la primera petición de la ventana; 429 al exceder. */
  private async enforce(key: string, limit: number, windowSec: number): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSec);
    if (count > limit) {
      const ttl = await this.redis.ttl(key);
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: 'Demasiadas peticiones, intenta más tarde',
          details: { retryAfterSeconds: ttl > 0 ? ttl : windowSec },
        },
        429,
      );
    }
  }
}
