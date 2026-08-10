import { Injectable, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { KOBRAX, type AuthAccountOption, type AuthTokens, type LoginResult } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TokenService } from './token.service';
import { PermissionsService } from './permissions.service';
import { SessionService } from './session.service';
import { MfaService } from './mfa.service';
import {
  accountLocked,
  accountNotAllowed,
  invalidCredentials,
  invalidPreAuth,
  invalidToken,
  mfaInvalid,
  noActiveTenant,
  refreshRetry,
  reuseDetected,
} from './auth.errors';

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
  deviceType?: string; // web | mobile | api
  deviceName?: string;
  os?: string;
}

interface MembershipRow {
  user_account_id: string;
  account_id: string;
  role_id: string;
  branch_id: string | null;
  is_default: boolean;
  is_owner: boolean;
  account_name: string;
  account_status: string;
  role_name: string;
}

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const GRACE_MS = 10_000;

/** Roles que exigen MFA obligatorio (F2b enforcement). */
const CRITICAL_ROLES = ['SUPER_ADMIN', 'ACCOUNT_ADMIN'];

@Injectable()
export class AuthService implements OnModuleInit {
  /** Hash dummy para comparar en timing constante cuando el usuario no existe. */
  private dummyHash = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly token: TokenService,
    private readonly permissions: PermissionsService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.dummyHash = await hash('timing-guard-not-a-real-password', KOBRAX.BCRYPT_WORK_FACTOR);
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  async login(email: string, password: string, meta: SessionMeta): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Usuario inexistente: comparar contra dummy para no filtrar por timing.
    if (!user) {
      await compare(password, this.dummyHash);
      throw invalidCredentials();
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw accountLocked(user.lockedUntil);
    }
    if (user.status !== 'ACTIVE') {
      await compare(password, this.dummyHash);
      throw invalidCredentials();
    }

    const ok = await compare(password, user.passwordHash);
    if (!ok) {
      await this.registerFailedAttempt(user.id, user.failedLoginAttempts);
      throw invalidCredentials();
    }

    // Éxito: resetea contador y registra último acceso.
    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    });

    // Máquina de estados: password → (MFA si enabled) → (empresa si ≥2) → tokens.
    // El paso MFA va antes que el de empresa para no filtrar membresías sin 2º factor.
    if (user.mfaEnabled && user.mfaSecret) {
      return { step: 'mfa', preAuthToken: this.token.signPreAuth({ sub: user.id, purpose: 'mfa' }) };
    }

    const active = await this.activeMemberships(user.id);
    if (active.length === 0) throw noActiveTenant();

    // F2b: MFA obligatorio para roles críticos → forzar enroll antes de continuar.
    if (active.some((m) => CRITICAL_ROLES.includes(m.role_name))) {
      return {
        step: 'mfa_setup',
        preAuthToken: this.token.signPreAuth({ sub: user.id, purpose: 'mfa_enroll' }),
      };
    }
    return this.proceedFromMemberships(user.id, active, meta);
  }

  // ── Paso MFA: valida 2º factor con un pre-auth token de propósito 'mfa' ──────
  async mfaChallenge(preAuthToken: string, code: string, meta: SessionMeta): Promise<LoginResult> {
    let pre;
    try {
      pre = this.token.verifyPreAuth(preAuthToken, 'mfa');
    } catch {
      throw invalidPreAuth();
    }
    const ok = await this.mfa.challenge(pre.sub, code);
    if (!ok) throw mfaInvalid();
    return this.proceedToAccountStep(pre.sub, meta, true);
  }

  // ── Paso empresa: selección explícita cuando el usuario tiene ≥2 tenants ─────
  async selectAccount(preAuthToken: string, accountId: string, meta: SessionMeta): Promise<AuthTokens> {
    let pre;
    try {
      pre = this.token.verifyPreAuth(preAuthToken, 'select_account');
    } catch {
      throw invalidPreAuth();
    }
    const active = await this.activeMemberships(pre.sub);
    const membership = active.find((m) => m.account_id === accountId);
    if (!membership) throw accountNotAllowed();
    return this.issueTokens(pre.sub, membership.account_id, membership.role_id, meta);
  }

  // ── Cambio de empresa con la sesión ya iniciada (Bearer) ─────────────────────
  //
  // `selectAccount` de arriba resuelve el paso del login: exige un pre-auth token que vive 5
  // minutos y sólo existe *entre* pasos. Una vez dentro del panel no queda nada con qué
  // cambiar de empresa, y hasta hoy la única salida era cerrar sesión y volver a entrar.

  /** Empresas donde el usuario puede operar hoy. Misma forma que el selector del login. */
  async listAccounts(userId: string): Promise<AuthAccountOption[]> {
    const active = await this.activeMemberships(userId);
    return active.map((m) => ({
      id: m.account_id,
      name: m.account_name,
      role: m.role_name,
      status: m.account_status,
    }));
  }

  /**
   * Emite un par de tokens para otra empresa del usuario y **revoca la sesión anterior**.
   *
   * Lo segundo no es cosmético: sin revocar queda vivo un refresh token que sigue devolviendo
   * tokens de la empresa vieja, o sea una puerta de atrás al tenant que la persona acaba de
   * dejar. `revokeOne` es idempotente y también lo mete en la denylist, así que el access
   * token anterior muere ya, sin esperar sus 15 minutos.
   *
   * El rol y los permisos salen de la membresía destino (`issueTokens` los re-deriva): nunca
   * se arrastran los del token viejo.
   *
   * El MFA no se vuelve a pedir — ya se verificó en este login. Cambiar de empresa es
   * re-alcanzar la misma sesión, no autenticarse de nuevo.
   *
   * 🔴 **Sí se vuelve a mirar el estado del usuario.** Este endpoint **emite credenciales
   * nuevas** (una sesión y un refresh de 7 días), así que tiene que aplicar las mismas guardas
   * que `login()`: nadie revoca las sesiones vivas cuando a alguien se lo suspende, de modo
   * que una persona dada de baja podía, dentro de los 15 minutos de su access token, saltar a
   * otra empresa y quedarse operando ahí una semana. El `login()` la habría frenado.
   */
  async switchAccount(
    userId: string,
    currentSessionId: string,
    accountId: string,
    meta: SessionMeta,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw invalidToken();
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw accountLocked(user.lockedUntil);

    const active = await this.activeMemberships(userId);
    const membership = active.find((m) => m.account_id === accountId);
    // Mismo error que `selectAccount`: no distingue «no existe» de «no sos miembro».
    if (!membership) throw accountNotAllowed();

    const tokens = await this.issueTokens(userId, membership.account_id, membership.role_id, meta);
    await this.sessions.revokeOne(userId, currentSessionId);
    return tokens;
  }

  /** Membresías del usuario en tenants que permiten login (cross-tenant, SECURITY DEFINER). */
  private async activeMemberships(userId: string): Promise<MembershipRow[]> {
    const memberships = await this.prisma.$queryRaw<MembershipRow[]>`
      SELECT * FROM auth_memberships(${userId})`;
    // CU-01: se bloquea login en tenants SUSPENDED/CANCELLED/INACTIVE.
    // ACTIVE (operación normal) y TRIAL (acceso parcial) sí permiten login.
    return memberships.filter(
      (m) => !['SUSPENDED', 'CANCELLED', 'INACTIVE'].includes(m.account_status),
    );
  }

  /** Fetch de membresías + resolución del paso de empresa. */
  private async proceedToAccountStep(
    userId: string,
    meta: SessionMeta,
    mfaVerified: boolean,
  ): Promise<LoginResult> {
    const active = await this.activeMemberships(userId);
    if (active.length === 0) throw noActiveTenant();
    return this.proceedFromMemberships(userId, active, meta, mfaVerified);
  }

  /**
   * Resuelve el paso de empresa con membresías ya consultadas: 1 → emite tokens,
   * ≥2 → devuelve la lista y un pre-auth token de propósito 'select_account'.
   */
  private async proceedFromMemberships(
    userId: string,
    active: MembershipRow[],
    meta: SessionMeta,
    mfaVerified = false,
  ): Promise<LoginResult> {
    if (active.length === 1) {
      const m = active[0]!;
      const tokens = await this.issueTokens(userId, m.account_id, m.role_id, meta);
      return { step: 'done', ...tokens };
    }

    return {
      step: 'select_account',
      preAuthToken: this.token.signPreAuth({ sub: userId, purpose: 'select_account', mfaVerified }),
      accounts: active.map((m) => ({
        id: m.account_id,
        name: m.account_name,
        role: m.role_name,
        status: m.account_status,
      })),
    };
  }

  // ── MFA enroll/verify (Bearer) — delegan en MfaService ──────────────────────
  async enrollMfa(userId: string) {
    return this.mfa.enroll(userId);
  }

  async verifyMfa(userId: string, code: string): Promise<{ enabled: true; backupCodes: string[] }> {
    const backupCodes = await this.mfa.verify(userId, code);
    return { enabled: true, backupCodes };
  }

  // ── MFA obligatorio (F2b): setup gated por pre-auth token 'mfa_enroll' ───────
  async mfaSetupStart(preAuthToken: string) {
    const pre = this.verifyEnrollToken(preAuthToken);
    return this.mfa.enroll(pre.sub);
  }

  /** Confirma el setup obligatorio: activa MFA y **completa el login** (emite tokens). */
  async mfaSetupVerify(
    preAuthToken: string,
    code: string,
    meta: SessionMeta,
  ): Promise<LoginResult & { backupCodes: string[] }> {
    const pre = this.verifyEnrollToken(preAuthToken);
    const backupCodes = await this.mfa.verify(pre.sub, code);
    const result = await this.proceedToAccountStep(pre.sub, meta, true);
    return { ...result, backupCodes };
  }

  /**
   * Postergar el MFA obligatorio: **completa el login sin activarlo**.
   *
   * Decisión de producto (2026-07-31, explícita de la dueña): se puede postergar
   * indefinidamente. El recordatorio es blando y vive en el cliente — `GET /auth/me` ya
   * devuelve `mfaEnabled`, y el Home pinta un aviso mientras siga en false.
   *
   * Consecuencia asumida: un `ACCOUNT_ADMIN` puede operar sin segundo factor, así que la
   * contraseña vuelve a ser la única barrera para quien administra el tenant y cobra. El
   * `mfaVerified: false` que viaja al paso de empresa deja el rastro de que no se verificó.
   */
  async mfaSetupSkip(preAuthToken: string, meta: SessionMeta): Promise<LoginResult> {
    const pre = this.verifyEnrollToken(preAuthToken);
    return this.proceedToAccountStep(pre.sub, meta, false);
  }

  private verifyEnrollToken(preAuthToken: string) {
    try {
      return this.token.verifyPreAuth(preAuthToken, 'mfa_enroll');
    } catch {
      throw invalidPreAuth();
    }
  }

  // ── MFA disable / regenerar backup codes (Bearer) — delegan en MfaService ────
  async disableMfa(userId: string, opts: { password?: string; code?: string }): Promise<void> {
    await this.mfa.disable(userId, opts);
  }

  async regenerateBackupCodes(userId: string): Promise<{ backupCodes: string[] }> {
    return { backupCodes: await this.mfa.regenerateBackupCodes(userId) };
  }

  // ── Identidad de la sesión actual (Bearer) ───────────────────────────────────
  async me(user: {
    userId: string;
    accountId: string;
    roleId: string;
    permissions: string[];
  }): Promise<{
    userId: string;
    email: string;
    profile: { firstName: string; lastName: string; photoUrl?: string } | null;
    accountId: string;
    role: string;
    permissions: string[];
    mfaEnabled: boolean;
    requiresPasswordChange: boolean;
  }> {
    // users/profiles/roles son tablas globales (sin RLS) → acceso directo.
    const [dbUser, role] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: user.userId }, include: { profile: true } }),
      this.prisma.role.findUnique({ where: { id: user.roleId }, select: { name: true } }),
    ]);
    if (!dbUser) throw invalidToken();

    return {
      userId: dbUser.id,
      email: dbUser.email,
      profile: dbUser.profile
        ? {
            firstName: dbUser.profile.firstName,
            lastName: dbUser.profile.lastName,
            photoUrl: dbUser.profile.photoUrl ?? undefined,
          }
        : null,
      accountId: user.accountId,
      role: role?.name ?? 'UNKNOWN',
      permissions: user.permissions,
      mfaEnabled: dbUser.mfaEnabled,
      requiresPasswordChange: dbUser.requiresPasswordChange,
    };
  }

  private async registerFailedAttempt(userId: string, current: number): Promise<void> {
    const attempts = current + 1;
    const data: { failedLoginAttempts: number; lockedUntil?: Date } = {
      failedLoginAttempts: attempts,
    };
    if (attempts >= KOBRAX.MAX_FAILED_LOGINS) {
      data.lockedUntil = new Date(Date.now() + KOBRAX.ACCOUNT_LOCK_MINUTES * 60 * 1000);
    }
    await this.prisma.user.update({ where: { id: userId }, data });
  }

  /** Crea sesión + refresh y firma el access, dentro del contexto RLS del tenant. */
  private async issueTokens(
    userId: string,
    accountId: string,
    roleId: string,
    meta: SessionMeta,
  ): Promise<AuthTokens> {
    const permissions = await this.permissions.forRole(roleId);
    const familyId = randomBytes(16).toString('hex');

    return this.prisma.withTenant(accountId, async (tx) => {
      const session = await tx.userSession.create({
        data: {
          userId,
          accountId,
          ipAddress: meta.ip,
          deviceInfo: meta.userAgent,
          deviceType: meta.deviceType ?? 'api',
          deviceName: meta.deviceName,
          os: meta.os,
          loginAt: new Date(),
          lastSeenAt: new Date(),
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
          isActive: true,
        },
      });

      const refresh = this.token.signRefresh({
        sub: userId,
        accountId,
        sessionId: session.id,
        familyId,
      });
      await tx.refreshToken.create({
        data: {
          accountId,
          userId,
          tokenHash: refresh.hash,
          familyId,
          sessionId: session.id,
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });

      const accessToken = this.token.signAccess({
        sub: userId,
        accountId,
        roleId,
        permissions,
        sessionId: session.id,
      });
      return { accessToken, refreshToken: refresh.token };
    });
  }

  // ── Refresh rotatorio (reuso + ventana de gracia) ───────────────────────────
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let claims;
    try {
      claims = this.token.verifyRefresh(refreshToken);
    } catch {
      throw invalidToken();
    }
    if (claims.type !== 'refresh') throw invalidToken();
    const tokenHash = this.token.hash(claims.jti);

    // IMPORTANTE: la revocación se confirma DENTRO de la transacción y el error se
    // lanza FUERA — si lanzáramos dentro, Prisma haría rollback y la revocación se
    // perdería (el refresh reutilizado seguiría siendo válido).
    type Outcome =
      | { kind: 'invalid' }
      | { kind: 'retry' }
      | { kind: 'reuse'; sessionId: string }
      | { kind: 'ok'; tokens: AuthTokens };

    const outcome = await this.prisma.withTenant<Outcome>(claims.accountId, async (tx) => {
      const rt = await tx.refreshToken.findFirst({ where: { tokenHash } });
      if (!rt) return { kind: 'invalid' };

      if (rt.revokedAt) {
        const age = Date.now() - rt.revokedAt.getTime();
        if (age <= GRACE_MS) return { kind: 'retry' }; // race concurrente, no es ataque
        // Reuso real → revoca toda la familia y la sesión (se confirma al retornar).
        await tx.refreshToken.updateMany({
          where: { familyId: rt.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.userSession.updateMany({
          where: { id: rt.sessionId },
          data: { revokedAt: new Date(), isActive: false },
        });
        return { kind: 'reuse', sessionId: rt.sessionId };
      }

      // Revocación atómica (compare-and-swap) para ganar la carrera.
      const cas = await tx.refreshToken.updateMany({
        where: { id: rt.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (cas.count === 0) return { kind: 'retry' };

      const ua = await tx.userAccount.findFirst({
        where: { userId: claims.sub, accountId: claims.accountId, isActive: true },
      });
      if (!ua) return { kind: 'invalid' };
      const permissions = await this.permissions.forRole(ua.roleId);

      const newRefresh = this.token.signRefresh({
        sub: claims.sub,
        accountId: claims.accountId,
        sessionId: claims.sessionId,
        familyId: rt.familyId,
      });
      const created = await tx.refreshToken.create({
        data: {
          accountId: claims.accountId,
          userId: claims.sub,
          tokenHash: newRefresh.hash,
          familyId: rt.familyId,
          sessionId: claims.sessionId,
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });
      await tx.refreshToken.update({ where: { id: rt.id }, data: { replacedBy: created.id } });
      await tx.userSession.updateMany({
        where: { id: claims.sessionId },
        data: { lastSeenAt: new Date() },
      });

      const accessToken = this.token.signAccess({
        sub: claims.sub,
        accountId: claims.accountId,
        roleId: ua.roleId,
        permissions,
        sessionId: claims.sessionId,
      });
      return { kind: 'ok', tokens: { accessToken, refreshToken: newRefresh.token } };
    });

    if (outcome.kind === 'invalid') throw invalidToken();
    if (outcome.kind === 'retry') throw refreshRetry();
    if (outcome.kind === 'reuse') {
      await this.sessions.denylist(outcome.sessionId); // revocación instantánea
      throw reuseDetected();
    }
    return outcome.tokens;
  }

  // ── Logout (revoca refresh + sesión; idempotente) ───────────────────────────
  async logout(refreshToken: string): Promise<void> {
    let claims;
    try {
      claims = this.token.verifyRefresh(refreshToken);
    } catch {
      return; // idempotente: token inválido → nada que revocar
    }

    await this.prisma.withTenant(claims.accountId, async (tx) => {
      await tx.refreshToken.updateMany({
        where: { sessionId: claims.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.userSession.updateMany({
        where: { id: claims.sessionId },
        data: { revokedAt: new Date(), isActive: false, logoutAt: new Date() },
      });
    });
    await this.sessions.denylist(claims.sessionId);
  }
}
