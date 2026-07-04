import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from '../token.service';
import { SessionService } from '../session.service';
import { invalidToken } from '../auth.errors';

/** Identidad autenticada adjunta a `request.user` por el guard. */
export interface AuthenticatedUser {
  userId: string;
  accountId: string;
  roleId: string;
  permissions: string[];
  sessionId: string;
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
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers['authorization'];
    if (!header?.startsWith('Bearer ')) throw invalidToken();

    let claims;
    try {
      claims = this.token.verifyAccess(header.slice(7));
    } catch {
      throw invalidToken();
    }

    if (await this.sessions.isRevoked(claims.sessionId)) throw invalidToken();

    (req as Request & { user: AuthenticatedUser }).user = {
      userId: claims.sub,
      accountId: claims.accountId,
      roleId: claims.roleId,
      permissions: claims.permissions,
      sessionId: claims.sessionId,
    };
    return true;
  }
}
