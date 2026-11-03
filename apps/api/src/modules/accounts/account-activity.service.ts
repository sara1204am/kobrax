import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import type { AccountActivityPage, PlanHistoryEntry } from '@kobrax/shared';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { decodeCursor, encodeCursor, keysetWhere, pageLimit } from '../users/member-detail.service';
import { ACCOUNT_ACTIVITY_ENTITIES, describeChanges, viaOf } from './audit-view';

type Json = Record<string, unknown> | null;
const asJson = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Qué se cambió en la cuenta y quién lo hizo (Refactor de Cuenta · F7). Es una lectura de `audit_logs` —que ya recibe
 * toda mutación— acotada a las entidades de la cuenta, con los cambios ya digeridos (ver `audit-view`).
 *
 * El registro incluye IPs y cambios de seguridad: el controlador lo limita a `audit:read`.
 */
@Injectable()
export class AccountActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  async activity(opts: { before?: string; limit?: number; entity?: string; userId?: string }): Promise<AccountActivityPage> {
    const limit = pageLimit(Number(opts.limit));
    // Un `entity` fuera de la lista se ignora en vez de abrir el registro entero.
    const entities = opts.entity && (ACCOUNT_ACTIVITY_ENTITIES as readonly string[]).includes(opts.entity) ? [opts.entity] : [...ACCOUNT_ACTIVITY_ENTITIES];
    const cursor = decodeCursor(opts.before);

    return this.tx(async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: {
          accountId: this.tenant.accountId,
          entity: { in: entities },
          ...(opts.userId ? { userId: opts.userId } : {}),
          ...keysetWhere('createdAt', '', cursor),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);

      const actors = await tx.user.findMany({
        where: { id: { in: [...new Set(page.map((r) => r.userId))] } },
        select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
      });
      const actorName = (id: string) => {
        const a = actors.find((x) => x.id === id);
        if (!a) return null;
        return [a.profile?.firstName, a.profile?.lastName].filter(Boolean).join(' ') || a.email;
      };

      const items = page.map((r) => {
        const via = viaOf(r.after);
        return {
          id: r.id,
          at: r.createdAt.toISOString(),
          entity: r.entity,
          action: r.action,
          // Un cambio por consola va a nombre del dueño (la base exige un usuario): decir su nombre sería mentir.
          actorName: via ? null : actorName(r.userId),
          ip: r.ip,
          changes: r.action === 'UPDATE' ? describeChanges(r.before, r.after) : [],
          via,
        };
      });
      const last = page[page.length - 1];
      return { items, next: rows.length > limit && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null };
    });
  }

  /** Los cambios de plan y de estado que hizo Kobrax por consola (`plan:set`, `account:suspend`, `plan:lifecycle`). */
  async planHistory(): Promise<PlanHistoryEntry[]> {
    return this.tx(async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { accountId: this.tenant.accountId, entity: 'account', entityId: this.tenant.accountId, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.flatMap((r): PlanHistoryEntry[] => {
        const via = viaOf(r.after);
        if (!via) return [];
        const before = asJson(r.before);
        const after = asJson(r.after);
        const entry = {
          id: r.id,
          at: r.createdAt.toISOString(),
          via,
          fromPlan: str(before?.planCode),
          toPlan: str(after?.planCode),
          fromStatus: str(before?.status),
          toStatus: str(after?.status),
        };
        // `plan:set --override` sólo toca los topes: no es un cambio de plan ni de estado.
        const changed = entry.fromPlan !== entry.toPlan || entry.fromStatus !== entry.toStatus;
        return changed ? [entry] : [];
      }).slice(0, 50);
    });
  }
}
