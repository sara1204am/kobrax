import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../modules/auth/guards/jwt-auth.guard';
import { TenantContextService } from './tenant-context.service';

/**
 * Abre el contexto de tenant (AsyncLocalStorage) para todo el request autenticado,
 * usando la identidad que el `JwtAuthGuard` puso en `request.user`. Los guards corren
 * ANTES que los interceptores, así que `request.user` ya está disponible aquí.
 *
 * Si el request no está autenticado (login, health…) no abre contexto → pass-through.
 *
 * Patrón con Observable: la suscripción a `next.handle()` ocurre DENTRO de `als.run`,
 * de modo que el handler y sus awaits heredan el contexto (si solo se llamara
 * `als.run(() => next.handle())` el scope se cerraría antes de que Nest se suscriba).
 */
/** El header como texto corto o `undefined`: nunca se propaga basura larga ni arreglos al contexto. */
function clientVersionOf(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  const text = typeof raw === 'string' ? raw.trim().slice(0, 32) : '';
  return text || undefined;
}

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = req.user;
    if (!user?.accountId) return next.handle();

    return new Observable((subscriber) => {
      this.tenantContext.run(
        {
          accountId: user.accountId,
          userId: user.userId,
          permissions: user.permissions ?? [],
          sessionId: user.sessionId,
          requestId: req.headers['x-request-id'] as string | undefined,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          appVersion: clientVersionOf(req.headers['x-app-version']),
        },
        () => {
          next.handle().subscribe(subscriber);
        },
      );
    });
  }
}
