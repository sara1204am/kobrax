import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Contexto del request autenticado, propagado por AsyncLocalStorage. */
export interface RequestContext {
  accountId: string;
  userId: string;
  sessionId?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Contexto de tenant por request (AsyncLocalStorage). Lo puebla el
 * `TenantContextInterceptor` con la identidad del JWT y lo consumen los servicios
 * (p.ej. `prisma.withTenant(tenantContext.accountId, …)`) y el `AuditService` para
 * no tener que pasar `accountId`/`userId` por todos lados.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  /** Ejecuta `fn` dentro del contexto dado (la propagación cruza awaits/promesas). */
  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  /** Contexto actual o `undefined` si el request no está autenticado. */
  get(): RequestContext | undefined {
    return this.als.getStore();
  }

  /** `accountId` actual; lanza si no hay contexto (uso indebido fuera de un request con tenant). */
  get accountId(): string {
    const ctx = this.als.getStore();
    if (!ctx) throw new Error('TenantContext no disponible: no hay tenant en el request actual');
    return ctx.accountId;
  }

  /** `userId` actual o `undefined`. */
  get userId(): string | undefined {
    return this.als.getStore()?.userId;
  }
}
