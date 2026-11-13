import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SUPPORT_MAX_TTL_MINUTES, SUPPORT_SENSITIVE_PERMISSIONS, SUPPORT_SENSITIVE_READ_PERMISSIONS, needsSupportConsent, supportMaxPermissions } from '@kobrax/shared';
import type { SupportSession } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { AuditService } from '../../common/audit/audit.service';
import { TokenService } from '../auth/token.service';
import { supportWriteEnabled } from './platform-switches';

export interface OpenSupportSessionInput {
  accountId: string;
  reason: string;
  ticket?: string;
  ttlMinutes: number;
  permissions: string[];
}

const notFound = () => new NotFoundException({ code: 'SUPPORT_001', message: 'Acceso de soporte no encontrado' });

export type SupportSessionView = ReturnType<typeof viewOf>;
function viewOf(s: SupportSession, now = new Date()) {
  return {
    id: s.id,
    reason: s.reason,
    ticket: s.ticket ?? undefined,
    permissions: s.permissions,
    sensitive: s.sensitive,
    consentStatus: s.consentStatus,
    expiresAt: s.expiresAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    revokedAt: s.revokedAt?.toISOString(),
    /** ACTIVE (vigente) | EXPIRED | REVOKED | DENIED | AWAITING_CONSENT. Calculado, no guardado. */
    status: s.revokedAt ? 'REVOKED' : s.consentStatus === 'DENIED' ? 'DENIED' : s.expiresAt <= now ? 'EXPIRED' : s.consentStatus === 'PENDING' ? 'AWAITING_CONSENT' : 'ACTIVE',
  };
}

/**
 * F14 · F5 (ADR-F14-08, H-11): el acceso EXCEPCIONAL de plataforma a una cuenta, y el lado de la cuenta que lo consiente.
 *
 *  · Plataforma abre la sesión (motivo, ticket, ≤ 240 min, permisos pedidos ∩ el máximo de soporte). Si pide escritura sensible queda PENDIENTE hasta que
 *    el ACCOUNT_ADMIN de ESA cuenta la acepte; el token de soporte sólo lleva la escritura sensible con consentimiento Y con `SUPPORT_WRITE_ENABLED`.
 *  · Todo lo que plataforma hace queda auditado con `actor_type = PLATFORM` y la sesión.
 *  · La cuenta ve sus accesos de soporte, los acepta, los rechaza o los revoca en cualquier momento.
 */
@Injectable()
export class SupportSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly audit: AuditService,
    private readonly token: TokenService,
  ) {}

  // ── Lado de plataforma ──────────────────────────────────────────────────────────────────────────────────────────────────────────

  async open(platformUserId: string, input: OpenSupportSessionInput) {
    if (!Number.isInteger(input.ttlMinutes) || input.ttlMinutes < 1 || input.ttlMinutes > SUPPORT_MAX_TTL_MINUTES) {
      throw new BadRequestException({ code: 'SUPPORT_002', message: `La sesión de soporte dura entre 1 y ${SUPPORT_MAX_TTL_MINUTES} minutos` });
    }
    const max = new Set(supportMaxPermissions());
    const permissions = [...new Set(input.permissions.filter((p) => max.has(p)))];
    if (permissions.length === 0) throw new BadRequestException({ code: 'SUPPORT_003', message: 'Ningún permiso pedido está permitido para soporte' });
    const sensitive = needsSupportConsent(permissions);
    const now = new Date();
    return this.prisma.withSystemTenant(input.accountId, async (tx) => {
      const account = await tx.account.findFirst({ where: { id: input.accountId, deletedAt: null }, select: { id: true } });
      if (!account) throw notFound();
      const session = await tx.supportSession.create({
        data: {
          accountId: input.accountId,
          platformUserId,
          reason: input.reason,
          ticket: input.ticket,
          permissions,
          sensitive,
          consentStatus: sensitive ? 'PENDING' : 'NOT_REQUIRED',
          expiresAt: new Date(now.getTime() + input.ttlMinutes * 60_000),
          createdAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          accountId: input.accountId,
          userId: null,
          actorType: 'PLATFORM',
          actorId: platformUserId,
          supportSessionId: session.id,
          action: 'SUPPORT_SESSION_OPEN',
          entity: 'support_session',
          entityId: session.id,
          after: { reason: input.reason, ticket: input.ticket ?? null, ttlMinutes: input.ttlMinutes, permissions, sensitive },
        },
      });
      return { ...viewOf(session), consentRequired: sensitive };
    });
  }

  /**
   * El token de acceso de una sesión vigente. Lo sensible entra sólo con consentimiento: la LECTURA de datos personales con el consentimiento
   * dado; la ESCRITURA sensible, además, con el interruptor `SUPPORT_WRITE_ENABLED` encendido. Una sesión rechazada o cuyo consentimiento se retiró
   * no da token. El vencimiento que se informa es el del TOKEN (el menor entre la sesión y la vida del acceso), no el de la sesión.
   */
  async issueToken(platformUserId: string, accountId: string, id: string): Promise<{ accessToken: string; expiresAt: string; permissions: string[] }> {
    const session = await this.prisma.withSystemTenant(accountId, (tx) => tx.supportSession.findFirst({ where: { id, accountId, platformUserId } }));
    if (!session) throw notFound();
    const now = new Date();
    if (session.revokedAt || session.expiresAt <= now || session.consentStatus === 'DENIED' || session.consentStatus === 'REVOKED') {
      throw new ConflictException({ code: 'SUPPORT_004', message: 'La sesión de soporte ya no está vigente' });
    }
    const consented = session.consentStatus === 'GRANTED';
    const writeOk = consented && supportWriteEnabled();
    const permissions = session.permissions.filter((p) => {
      if (SUPPORT_SENSITIVE_PERMISSIONS.includes(p)) return writeOk;
      if (SUPPORT_SENSITIVE_READ_PERMISSIONS.includes(p)) return consented;
      return true;
    });
    const accessToken = this.token.signAccess({
      sub: platformUserId,
      accountId,
      roleId: 'platform-support',
      permissions,
      sessionId: `support:${session.id}`,
      av: 0,
      pv: 0,
      actorType: 'PLATFORM',
      supportSessionId: session.id,
    });
    const exp = (JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number }).exp;
    const tokenExpiry = exp ? new Date(Math.min(exp * 1000, session.expiresAt.getTime())) : session.expiresAt;
    return { accessToken, expiresAt: tokenExpiry.toISOString(), permissions };
  }

  listForAccount(accountId: string) {
    return this.prisma.withSystemTenant(accountId, async (tx) => {
      const rows = await tx.supportSession.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50 });
      return rows.map((r) => viewOf(r));
    });
  }

  // ── Lado de la cuenta (el administrador) ───────────────────────────────────────────────────────────────────────────────────────

  private tx<T>(fn: (tx: import('@prisma/client').PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async list(): Promise<SupportSessionView[]> {
    const rows = await this.tx((tx) => tx.supportSession.findMany({ where: { accountId: this.tenant.accountId }, orderBy: { createdAt: 'desc' }, take: 50 }));
    return rows.map((r) => viewOf(r));
  }

  /** La sesión que hoy usa quien llama (si entró por soporte): para el aviso «Sesión de soporte · vence HH:MM». */
  async current(): Promise<SupportSessionView | null> {
    const id = this.tenant.get?.()?.supportSessionId;
    if (!id) return null;
    const row = await this.tx((tx) => tx.supportSession.findFirst({ where: { id, accountId: this.tenant.accountId } }));
    return row ? viewOf(row) : null;
  }

  /** Acepta o rechaza una sesión PENDIENTE que pidió algo sensible. Atómico: si dos personas deciden a la vez, gana una y la otra recibe 409. */
  async decide(id: string, decision: 'GRANTED' | 'DENIED'): Promise<SupportSessionView> {
    const userId = this.tenant.userId ?? '';
    const accountId = this.tenant.accountId;
    const row = await this.tx(async (tx) => {
      const s = await tx.supportSession.findFirst({ where: { id, accountId } });
      if (!s) throw notFound();
      if (s.revokedAt || s.expiresAt <= new Date()) throw new ConflictException({ code: 'SUPPORT_004', message: 'La sesión de soporte ya no está vigente' });
      const won = await tx.supportSession.updateMany({
        where: { id, accountId, consentStatus: 'PENDING', revokedAt: null },
        data: { consentStatus: decision, consentBy: userId, consentAt: new Date() },
      });
      if (won.count === 0) throw new ConflictException({ code: 'SUPPORT_005', message: 'Esta sesión no espera consentimiento' });
      return tx.supportSession.findFirstOrThrow({ where: { id, accountId } });
    });
    await this.audit.record({ entity: 'support_session', entityId: id, action: decision === 'GRANTED' ? 'SUPPORT_CONSENT_GRANTED' : 'SUPPORT_CONSENT_DENIED' });
    return viewOf(row);
  }

  /** Corta el acceso de soporte YA (también lo puede hacer la cuenta en cualquier momento). Idempotente; conserva el primer revocador. */
  async revoke(id: string): Promise<SupportSessionView> {
    const userId = this.tenant.userId ?? '';
    const accountId = this.tenant.accountId;
    const row = await this.tx(async (tx) => {
      const s = await tx.supportSession.findFirst({ where: { id, accountId } });
      if (!s) throw notFound();
      const now = new Date();
      await tx.supportSession.updateMany({ where: { id, accountId, revokedAt: null }, data: { revokedAt: now, revokedBy: userId } });
      // Si ya había consentido, el consentimiento queda retirado (sin tocar uno rechazado ni pendiente).
      await tx.supportSession.updateMany({ where: { id, accountId, consentStatus: 'GRANTED' }, data: { consentStatus: 'REVOKED' } });
      return tx.supportSession.findFirstOrThrow({ where: { id, accountId } });
    });
    await this.audit.record({ entity: 'support_session', entityId: id, action: 'SUPPORT_SESSION_REVOKED' });
    return viewOf(row);
  }
}
