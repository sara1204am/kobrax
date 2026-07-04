import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type { SessionInfo } from '@kobrax/shared';
import { REDIS } from '../../redis/redis.module';
import { PrismaService } from '../../database/prisma.service';

const REVOKED_TTL_SECONDS = 7 * 24 * 60 * 60; // alineado con la vida del refresh

/** Fila cruda de `auth_user_sessions` (SECURITY DEFINER, cross-tenant). */
interface SessionRow {
  session_id: string;
  account_id: string;
  account_name: string;
  ip_address: string | null;
  device_name: string | null;
  device_type: string | null;
  os: string | null;
  city: string | null;
  country: string | null;
  login_at: Date | null;
  last_seen_at: Date | null;
  expires_at: Date | null;
}

/**
 * Sesiones de usuario: denylist Redis (revocación instantánea) + gestión
 * (listar / revocar) cross-tenant vía la función SECURITY DEFINER `auth_user_sessions`.
 * El `JwtAuthGuard` consulta `isRevoked` en cada request.
 */
@Injectable()
export class SessionService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  private key(sessionId: string): string {
    return `revoked_session:${sessionId}`;
  }

  async denylist(sessionId: string): Promise<void> {
    await this.redis.set(this.key(sessionId), '1', 'EX', REVOKED_TTL_SECONDS);
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(this.key(sessionId))) === 1;
  }

  /** Sesiones activas del usuario (cross-tenant). */
  private async activeRows(userId: string): Promise<SessionRow[]> {
    return this.prisma.$queryRaw<SessionRow[]>`SELECT * FROM auth_user_sessions(${userId})`;
  }

  /** Lista las sesiones activas para la UI de seguridad, marcando la actual. */
  async list(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const rows = await this.activeRows(userId);
    return rows.map((r) => ({
      id: r.session_id,
      accountName: r.account_name,
      ip: r.ip_address ?? undefined,
      deviceName: r.device_name ?? undefined,
      deviceType: r.device_type ?? undefined,
      os: r.os ?? undefined,
      city: r.city ?? undefined,
      country: r.country ?? undefined,
      loginAt: r.login_at?.toISOString(),
      lastSeenAt: r.last_seen_at?.toISOString(),
      isCurrent: r.session_id === currentSessionId,
    }));
  }

  /** Revoca los datos en DB de una sesión (RLS por tenant) y la añade a la denylist. */
  private async revokeRows(accountId: string, sessionId: string): Promise<void> {
    await this.prisma.withTenant(accountId, async (tx) => {
      await tx.refreshToken.updateMany({
        where: { sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.userSession.updateMany({
        where: { id: sessionId },
        data: { revokedAt: new Date(), isActive: false, logoutAt: new Date() },
      });
    });
    await this.denylist(sessionId);
  }

  /**
   * Revoca una sesión concreta del usuario (idempotente). Solo actúa si la sesión
   * pertenece al usuario y está activa; si no, no hace nada (no filtra ajenas).
   */
  async revokeOne(userId: string, sessionId: string): Promise<void> {
    const row = (await this.activeRows(userId)).find((r) => r.session_id === sessionId);
    if (!row) return; // ya revocada o no pertenece al usuario → idempotente
    await this.revokeRows(row.account_id, sessionId);
  }

  /** Revoca todas las sesiones del usuario, opcionalmente excepto una (la actual). */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<number> {
    const rows = await this.activeRows(userId);
    let count = 0;
    for (const r of rows) {
      if (exceptSessionId && r.session_id === exceptSessionId) continue;
      await this.revokeRows(r.account_id, r.session_id);
      count += 1;
    }
    return count;
  }
}
