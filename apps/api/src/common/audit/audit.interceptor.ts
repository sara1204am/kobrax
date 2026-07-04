import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import type { Request } from 'express';
import { AUDIT_KEY, type AuditMeta } from './audit.decorator';
import { AuditService, type AuditAction } from './audit.service';

/** POST→CREATE · PATCH/PUT→UPDATE · DELETE→DELETE · (GET/otros → no audita). */
function actionFromMethod(method: string): AuditAction | undefined {
  if (method === 'POST') return 'CREATE';
  if (method === 'PATCH' || method === 'PUT') return 'UPDATE';
  if (method === 'DELETE') return 'DELETE';
  return undefined;
}

/** Intenta extraer el id del recurso de la respuesta (`{id}` o `{data:{id}}`). */
function extractId(result: unknown): string | undefined {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.id === 'string') return r.id;
    const data = r.data as Record<string, unknown> | undefined;
    if (data && typeof data.id === 'string') return data.id;
  }
  return undefined;
}

/**
 * Auditoría automática de mutaciones en handlers decorados con `@Audit(entity)`.
 * Registra tras una respuesta exitosa (`after` = resultado, redactado). El `before`
 * se captura explícitamente en el servicio cuando hace falta (UPDATE/DELETE).
 * Handlers sin `@Audit` o métodos no mutantes → pass-through.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, context.getHandler());
    if (!meta) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const action = meta.action ?? actionFromMethod(req.method);
    if (!action) return next.handle();

    return next.handle().pipe(
      tap((result) => {
        const entityId = extractId(result) ?? (req.params?.id as string | undefined) ?? '';
        void this.audit.record({ entity: meta.entity, entityId, action, after: result });
      }),
    );
  }
}
