import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Verifica que la petición tiene un tenant activo en el contexto autenticado.
 * En F3 (endpoints de recursos) se extenderá para validar que el `:id` del recurso
 * pertenece a `request.user.accountId`; aquí garantiza la base (hay accountId).
 * Debe ejecutarse DESPUÉS de `JwtAuthGuard`.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!req.user?.accountId) {
      throw new ForbiddenException({ code: 'TENANT_001', message: 'Sin contexto de empresa' });
    }
    return true;
  }
}
