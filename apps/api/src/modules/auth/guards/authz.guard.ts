import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppConfigService } from '../../../config/app-config.service';
import { resolveAccess } from '../authz-access';
import type { AuthenticatedUser } from './jwt-auth.guard';

/**
 * F14 · F3: autorización por permisos con **negación por defecto**. Reemplaza a `RolesGuard`.
 * Va DESPUÉS de `JwtAuthGuard` y `TenantGuard` (guards globales, en ese orden).
 *
 *  - Sin contrato declarado → 403 `AUTHZ_000` (o, con `AUTHZ_DENY_BY_DEFAULT=log`, pasa y lo registra: válvula de rollback de un release).
 *  - `public` / `authenticated` → pasa (la sesión ya la validó el guard de JWT).
 *  - `permissions` → TODOS los de `all` y ALGUNO de `any`; si no, 403 `AUTH_002` (mismo código que `RolesGuard`).
 * La decisión contextual (`@Policy`) la toma el servicio: el guard no tiene la fila.
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  private readonly logger = new Logger(AuthzGuard.name);
  private readonly warned = new Set<string>();

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const access = resolveAccess(this.reflector, context.getHandler(), context.getClass());
    if (!access) {
      const where = `${context.getClass().name}.${context.getHandler().name}`;
      if (!this.config.authzDenyByDefault) {
        if (!this.warned.has(where)) {
          this.warned.add(where);
          this.logger.warn(`Handler sin contrato de acceso (modo log): ${where}`);
        }
        return true;
      }
      throw new ForbiddenException({ code: 'AUTHZ_000', message: 'Acceso no declarado para esta ruta' });
    }
    if (access.kind !== 'permissions') return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const have = req.user?.permissions ?? [];
    const ok = access.all.every((p) => have.includes(p)) && (access.any.length === 0 || access.any.some((p) => have.includes(p)));
    if (!ok) throw new ForbiddenException({ code: 'AUTH_002', message: 'No tienes permisos para esta acción' });
    return true;
  }
}
