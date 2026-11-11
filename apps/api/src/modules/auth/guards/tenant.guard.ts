import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { resolveAccess } from '../authz-access';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Verifica que la petición tiene un tenant activo en el contexto autenticado. Guard GLOBAL (F14 · F3), después de `JwtAuthGuard`:
 * se exige a todo handler con sesión (permisos o «sólo autenticado», como cuando era un `@UseGuards` de cada controlador);
 * sólo lo `@Public` queda fuera.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const kind = resolveAccess(this.reflector, context.getHandler(), context.getClass())?.kind;
    if (kind !== 'permissions' && kind !== 'authenticated') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    // F14 · F5: la persona de plataforma sin sesión de soporte (login de plataforma) no tiene empresa; sólo puede llamar a handlers que exigen
    // EXCLUSIVAMENTE permisos `platform:*` (que ningún usuario de empresa tiene). Cualquier otro handler sigue exigiendo empresa.
    if (req.user?.actorType === 'PLATFORM' && !req.user.accountId && !req.user.supportSessionId) {
      const access = resolveAccess(this.reflector, context.getHandler(), context.getClass());
      if (access?.kind === 'permissions' && access.all.length > 0 && access.all.every((p) => p.startsWith('platform:'))) return true;
    }
    if (!req.user?.accountId) {
      throw new ForbiddenException({ code: 'TENANT_001', message: 'Sin contexto de empresa' });
    }
    return true;
  }
}
