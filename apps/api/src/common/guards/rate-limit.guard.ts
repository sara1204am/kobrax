import { CanActivate, ExecutionContext, HttpException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type Redis from 'ioredis';
import { REDIS } from '../../redis/redis.module';
import { RATE_LIMIT_KEY, type RateLimitConfig } from '../decorators/rate-limit.decorator';

/** Límite global por IP (defensa de borde). Los endpoints sensibles lo endurecen con @RateLimit. */
const GLOBAL_LIMIT = 100;
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
    const route = `${req.method}:${path}`;
    await this.enforce(`rl:global:${ip}`, GLOBAL_LIMIT, GLOBAL_WINDOW);

    const cfg = this.reflector.get<RateLimitConfig>(RATE_LIMIT_KEY, context.getHandler());
    if (cfg) {
      await this.enforce(`rl:${route}:${this.identifier(cfg.by ?? 'ip', req, ip)}`, cfg.limit, cfg.windowSec);
    }
    return true;
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
