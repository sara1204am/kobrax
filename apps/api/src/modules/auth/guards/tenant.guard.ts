import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { resolveAccess } from '../authz-access';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Verifica que la petición tiene un tenant activo en el contexto autenticado. Guard GLOBAL (F14 · F3), después de `JwtAuthGuard`:
 * sólo se exige a los handlers con permisos (como cuando era un `@UseGuards` de los controladores con `@Roles`); lo público y lo
 * «sólo autenticado» no cambian.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (resolveAccess(this.reflector, context.getHandler(), context.getClass())?.kind !== 'permissions') return true;
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!req.user?.accountId) {
      throw new ForbiddenException({ code: 'TENANT_001', message: 'Sin contexto de empresa' });
    }
    return true;
  }
}
