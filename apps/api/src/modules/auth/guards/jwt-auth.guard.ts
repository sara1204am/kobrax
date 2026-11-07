import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { resolveAccess } from '../authz-access';
import { TokenService } from '../token.service';
import { SessionService } from '../session.service';
import { AuthzVersionService } from '../authz-version.service';
import { AppConfigService } from '../../../config/app-config.service';
import { authzStale, authzUnavailable, invalidToken } from '../auth.errors';
import { PrismaService } from '../../../database/prisma.service';
import { platformAccessEnabled, supportWriteEnabled } from '../../platform/platform-switches';

/** Identidad autenticada adjunta a `request.user` por el guard. */
export interface AuthenticatedUser {
  userId: string;
  accountId: string;
  roleId: string;
  /** F14 · F5: clave del rol de la cuenta (adicional a `roleId`). */
  roleKey?: string;
  /** F14 · F5: la persona de plataforma (sesión de soporte o login de plataforma). */
  actorType?: 'PLATFORM';
  supportSessionId?: string;
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
 * Es GLOBAL (F14 · F3): corre antes de `TenantGuard` y `AuthzGuard`; lo `@Public` no se autentica.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly token: TokenService,
    private readonly sessions: SessionService,
    private readonly authz: AuthzVersionService,
    private readonly config: AppConfigService,
    private readonly reflector: Reflector,
    /** F14 · F5: para revalidar la sesión de soporte en cada petición. Opcional: los specs anteriores a F5 no lo necesitan. */
    private readonly prisma?: PrismaService,
  ) {}

  /** ¿La sesión de soporte sigue vigente? No vencida, no revocada, de ESTA cuenta, y —si pidió escritura sensible— con consentimiento no retirado. */
  private async supportSessionActive(id: string, accountId: string): Promise<boolean> {
    if (!this.prisma) return false;
    const row = await this.prisma.withSystemTenant(accountId, (tx) =>
      tx.supportSession.findFirst({ where: { id, accountId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { consentStatus: true, sensitive: true } }),
    );
    if (!row) return false;
    return !(row.sensitive && (row.consentStatus === 'DENIED' || row.consentStatus === 'REVOKED'));
  }

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

    if (claims.actorType === 'PLATFORM') {
      // F14 · F5 (H-11): la plataforma entra sólo con el interruptor EXTERNO encendido; cada petición de una sesión de soporte revalida que siga vigente, y
      // la escritura de soporte necesita además su propio interruptor. Los interruptores se leen del entorno en cada petición, apagados por omisión.
      if (!platformAccessEnabled()) throw new ForbiddenException({ code: 'PLATFORM_DISABLED', message: 'El acceso de plataforma está deshabilitado' });
      if (claims.supportSessionId) {
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && !supportWriteEnabled()) {
          throw new ForbiddenException({ code: 'SUPPORT_WRITE_DISABLED', message: 'La escritura de soporte está deshabilitada' });
        }
        if (!(await this.supportSessionActive(claims.supportSessionId, claims.accountId))) throw invalidToken();
      }
    } else if (this.config.authzVersionCheck) {
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
      roleKey: claims.roleKey,
      actorType: claims.actorType,
      supportSessionId: claims.supportSessionId,
      permissions: claims.permissions,
      sessionId: claims.sessionId,
      av: claims.av,
      pv: claims.pv,
    };
    return true;
  }
}
