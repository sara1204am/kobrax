import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { resolveAccess } from '../authz-access';
import { TokenService } from '../token.service';
import { SessionService } from '../session.service';
import { AuthzVersionService } from '../authz-version.service';
import { AppConfigService } from '../../../config/app-config.service';
import { authzStale, authzUnavailable, invalidToken } from '../auth.errors';

/** Identidad autenticada adjunta a `request.user` por el guard. */
export interface AuthenticatedUser {
  userId: string;
  accountId: string;
  roleId: string;
  permissions: string[];
  sessionId: string;
  av?: number;
  pv?: number;
}

/**
 * Verifica el access token (Bearer) y consulta la **denylist de sesiones en Redis**
 * → revocación instantánea (logout / cierre de sesión / cambio de contraseña).
 * Adjunta la identidad en `request.user`.
 *
 * (Slice 4 de F2a añadirá RolesGuard/TenantGuard; este guard cubre la autenticación
 * y la revocación instantánea que F2b necesita en sus endpoints Bearer.)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly token: TokenService,
    private readonly sessions: SessionService,
    private readonly authz: AuthzVersionService,
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // F14 · F3: guard GLOBAL. Lo que se declaró `@Public()` no pide sesión; todo lo demás (incluido lo sin declarar) sí.
    if (resolveAccess(this.reflector, context.getHandler(), context.getClass())?.kind === 'public') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw invalidToken();

    let claims;
    try {
      claims = this.token.verifyAccess(header.slice(7));
    } catch {
      throw invalidToken();
    }

    if (this.config.authzVersionCheck) {
      // F14 · F1 (H-2): una sola ida a Redis (sesión revocada + versión de la membresía + versión de la política).
      // Si Redis no responde NO se deja pasar (falla cerrado) y con un código distinto de AUTHZ_STALE, para no provocar un bucle.
      let verdict;
      try {
        verdict = await this.authz.check(claims);
      } catch {
        throw authzUnavailable();
      }
      if (verdict === 'revoked') throw invalidToken();
      if (verdict === 'stale') throw authzStale();
    } else if (await this.sessions.isRevoked(claims.sessionId)) {
      throw invalidToken();
    }

    (req as Request & { user: AuthenticatedUser }).user = {
      userId: claims.sub,
      accountId: claims.accountId,
      roleId: claims.roleId,
      permissions: claims.permissions,
      sessionId: claims.sessionId,
      av: claims.av,
      pv: claims.pv,
    };
    return true;
  }
}
