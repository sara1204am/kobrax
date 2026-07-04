import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * Autorización por permisos. Lee los permisos exigidos por `@Roles(...)` y los
 * compara con los del usuario (resueltos por rol y embebidos en el access token).
 * Debe ejecutarse DESPUÉS de `JwtAuthGuard` (necesita `request.user`).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const permissions = req.user?.permissions ?? [];
    const ok = required.every((p) => permissions.includes(p));
    if (!ok) {
      throw new ForbiddenException({
        code: 'AUTH_002',
        message: 'No tienes permisos para esta acción',
      });
    }
    return true;
  }
}
