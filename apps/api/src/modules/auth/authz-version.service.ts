import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { REDIS } from '../../redis/redis.module';
import { PrismaService } from '../../database/prisma.service';

/** Una versión de membresía que ya está en la DB y todavía no se publicó en Redis. */
export interface PendingVersion {
  outboxId: string;
  accountId: string;
  userId: string;
  version: number;
}

export type AuthzCheck = 'ok' | 'revoked' | 'stale';

export const POLICY_VERSION_KEY = 'authz:policy_version';
export const RECONCILE_INTERVAL_MS = 30_000;
const RECONCILE_BATCH = 200;

/** Sólo escribe si la versión nueva es MAYOR: un llenado por «clave ausente» no puede pisar un bump más reciente. */
const SET_MAX_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]))
local new = tonumber(ARGV[1])
if cur == nil or new > cur then redis.call('SET', KEYS[1], ARGV[1]) return new end
return cur`;

export const membershipKey = (userId: string, accountId: string): string => `authz:${userId}:${accountId}`;
const revokedKey = (sessionId: string): string => `revoked_session:${sessionId}`;

/**
 * F14 · F1 (H-2) — versiones de autorización.
 *
 *  · `av` = `user_accounts.authz_version` (membresía): sube con cada cambio de rol / oficina / estado.
 *  · `pv` = `platform_settings.policy_version` (global): sube con cambios de catálogo o plantillas.
 *
 * La DB manda; Redis es la copia rápida que lee el guard en cada petición. El incremento se hace **en la misma transacción**
 * del cambio y deja una fila en `authz_version_outbox`; tras el commit se publica en Redis y, si eso falla, el reconciliador
 * (cada 30 s) la vacía. Nunca se responde éxito sin haber persistido en la DB.
 */
@Injectable()
export class AuthzVersionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuthzVersionService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    // La versión de política sube por migración (no pasa por la outbox): al arrancar, y luego en cada ciclo, se lleva a Redis.
    void this.syncPolicy();
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Lectura (guard) ────────────────────────────────────────────────────────

  /**
   * Una sola ida a Redis (`MGET`): sesión revocada, versión de la membresía y versión de la política. Si falta una clave de
   * versión se lee de la DB y se vuelve a poner. Lanza si Redis no responde (quien llama falla cerrado).
   */
  async check(claims: { sessionId: string; sub: string; accountId: string; av?: number; pv?: number }): Promise<AuthzCheck> {
    const [revoked, avRaw, pvRaw] = await this.redis.mget(
      revokedKey(claims.sessionId),
      membershipKey(claims.sub, claims.accountId),
      POLICY_VERSION_KEY,
    );
    if (revoked !== null) return 'revoked';

    const av = avRaw !== null ? Number(avRaw) : await this.fillMembership(claims.sub, claims.accountId);
    const pv = pvRaw !== null ? Number(pvRaw) : await this.fillPolicy();
    // Un token anterior a F14 · F1 (sin `av`/`pv`) no puede coincidir nunca: se renueva una vez y listo.
    if (av === null || claims.av === undefined || claims.av !== av) return 'stale';
    if (claims.pv === undefined || claims.pv !== pv) return 'stale';
    return 'ok';
  }

  /** La versión de la membresía desde la DB (null = no existe). Llena Redis. */
  private async fillMembership(userId: string, accountId: string): Promise<number | null> {
    const rows = await this.prisma.$queryRaw<{ v: number | null }[]>`SELECT authz_membership_version(${userId}, ${accountId}) AS v`;
    const v = rows[0]?.v ?? null;
    if (v !== null) await this.setMax(membershipKey(userId, accountId), v);
    return v;
  }

  /** La versión de la política desde la DB. Llena Redis. */
  private async fillPolicy(): Promise<number> {
    const row = await this.prisma.platformSetting.findUnique({ where: { id: 1 }, select: { policyVersion: true } });
    const v = row?.policyVersion ?? 1;
    await this.setMax(POLICY_VERSION_KEY, v);
    return v;
  }

  /** `pv` vigente, para firmar un token. */
  async currentPolicyVersion(tx?: PrismaClient): Promise<number> {
    const row = await (tx ?? this.prisma).platformSetting.findUnique({ where: { id: 1 }, select: { policyVersion: true } });
    return row?.policyVersion ?? 1;
  }

  // ── Escritura (dentro de la transacción del cambio) ────────────────────────

  /**
   * Sube `authz_version` de las membresías indicadas y deja una fila de outbox por cada una. Va DENTRO de la transacción del
   * cambio; después del commit hay que llamar a `publish` con lo que devuelve.
   */
  async bumpInTx(tx: PrismaClient, accountId: string, membershipIds: string[]): Promise<PendingVersion[]> {
    if (membershipIds.length === 0) return [];
    const rows = await tx.$queryRaw<{ user_id: string; authz_version: number }[]>`
      UPDATE user_accounts SET authz_version = authz_version + 1, updated_at = now()
      WHERE id = ANY(${membershipIds}::text[]) AND account_id = ${accountId}
      RETURNING user_id, authz_version`;
    const pending: PendingVersion[] = [];
    for (const r of rows) {
      const created = await tx.authzVersionOutbox.create({
        data: { accountId, userId: r.user_id, version: r.authz_version },
        select: { id: true },
      });
      pending.push({ outboxId: created.id, accountId, userId: r.user_id, version: r.authz_version });
    }
    return pending;
  }

  /** Tras el commit: publica en Redis y marca la outbox. Si Redis falla no se propaga: el reconciliador lo reintenta. */
  async publish(pending: PendingVersion[]): Promise<void> {
    if (pending.length === 0) return;
    try {
      for (const p of pending) await this.setMax(membershipKey(p.userId, p.accountId), p.version);
      await this.prisma.$queryRaw`SELECT authz_outbox_mark(${pending.map((p) => p.outboxId)}::text[])`;
    } catch (err) {
      this.logger.error(
        `No se pudo publicar la versión de autorización en Redis (${pending.length} pendiente/s; el reconciliador lo reintenta)`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  /** Deja Redis al día con una versión ya leída de la DB (emisión / refresh de tokens). Best-effort. */
  async warm(userId: string, accountId: string, av: number, pv: number): Promise<void> {
    try {
      await this.setMax(membershipKey(userId, accountId), av);
      await this.setMax(POLICY_VERSION_KEY, pv);
    } catch (err) {
      this.logger.warn(`No se pudo calentar la versión de autorización: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Vacía la outbox pendiente. Público para las pruebas; lo llama el temporizador. */
  async reconcile(): Promise<number> {
    await this.syncPolicy();
    try {
      const rows = await this.prisma.$queryRaw<{ id: string; account_id: string; user_id: string; version: number }[]>`
        SELECT * FROM authz_outbox_pending(${RECONCILE_BATCH})`;
      if (rows.length === 0) return 0;
      for (const r of rows) await this.setMax(membershipKey(r.user_id, r.account_id), r.version);
      await this.prisma.$queryRaw`SELECT authz_outbox_mark(${rows.map((r) => r.id)}::text[])`;
      this.logger.warn(`Reconciliadas ${rows.length} versión/es de autorización pendientes`);
      return rows.length;
    } catch (err) {
      this.logger.error('Falló la reconciliación de versiones de autorización', err instanceof Error ? err.stack : String(err));
      return 0;
    }
  }

  /** Lleva `platform_settings.policy_version` a Redis (sólo sube). Si Redis o la DB fallan, el próximo ciclo lo reintenta. */
  private async syncPolicy(): Promise<void> {
    try {
      await this.fillPolicy();
    } catch (err) {
      this.logger.error('No se pudo sincronizar la versión de política', err instanceof Error ? err.stack : String(err));
    }
  }

  private async setMax(key: string, value: number): Promise<void> {
    await this.redis.eval(SET_MAX_LUA, 1, key, String(value));
  }
}
