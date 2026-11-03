import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { CreditActivityType, RouteStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContextService } from '../../common/context/tenant-context.service';
import { maskIp, parseUserAgent } from './connection-info';
import { memberNotFound } from './users.errors';
import { serializeMember } from './users.serializer';

/** Los períodos que la pantalla ofrece. Cualquier otro valor cae al default: no se confía en el cliente. */
export const ACTIVITY_PERIODS = [7, 30, 90] as const;
export const DEFAULT_PERIOD = 30;

const MEMBER_DETAIL_INCLUDE = { user: { include: { profile: true } }, role: true, branch: true } as const;

/**
 * Roles que **operan en campo**: gestionan cartera, cobran y hacen rutas. Para ellos la actividad se
 * mide con lo que hacen sobre créditos. El resto (administrador, gerente, auditor, consulta) no
 * trabaja la cartera: su actividad es lo que hace en el panel, y eso es lo que se mide.
 */
const FIELD_ROLES = ['COLLECTOR', 'SUPERVISOR'];

export type ActivityKind = 'field' | 'admin';

export interface ActivityEvent {
  /** `tipo:id` de la fila de origen. Estable: el cliente lo usa para no repetir una fila en el borde de dos páginas. */
  id: string;
  type: 'ACTIVITY' | 'PAYMENT' | 'ROUTE' | 'ADMIN';
  at: string;
  /** Tipo de gestión (`CALL`, `VISIT`…) o `entity.action` de la acción administrativa. */
  code: string;
  /** El cliente de la gestión o el pago, cuando lo hay. */
  clientName?: string | null;
}

/** Los números de arriba de la pestaña Actividad. La lista va aparte, paginada (`activityEvents`). */
export interface MemberActivity {
  days: number;
  kind: ActivityKind;
  metrics: Record<string, number>;
}

/** Una página de una lista que crece sin tope: `nextCursor` es `null` cuando no hay más. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MemberConnection {
  id: string;
  loginAt: string;
  deviceType: string | null;
  browser: string | null;
  os: string | null;
  ip: string | null;
  city: string | null;
  country: string | null;
  /** Hoy sólo se guardan los accesos exitosos: un intento fallido no deja fila. */
  result: 'SUCCESS';
}

export interface MemberAuditEvent {
  id: string;
  at: string;
  /** `INVITED` · `INVITATION_RESENT` · `INVITATION_ACCEPTED` · `ROLE_CHANGED` · `DEACTIVATED` · `REACTIVATED` · `WORK_REASSIGNED`. */
  event: string;
  /** Datos para armar la frase (roles, conteos). Nunca el `before`/`after` crudo. */
  detail: Record<string, string | number | null>;
  actorName: string | null;
}

type Json = Record<string, unknown> | null;

const asJson = (v: unknown): Json => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null);

interface NamedClient {
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
}

function clientName(c: NamedClient | null | undefined): string | null {
  if (!c) return null;
  return c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || null;
}

/** Días de calendario distintos (en la zona de la cuenta) que aparecen entre las marcas de tiempo. */
export function distinctDays(stamps: Date[], timeZone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone });
  return new Set(stamps.map((d) => fmt.format(d))).size;
}

/**
 * El cursor de una lista paginada: el **instante y el id** del último elemento entregado. Sólo el instante no alcanza: un
 * import o un cierre masivo escribe cientos de filas en el mismo milisegundo, y con `at <= cursor` cada página devolvía las
 * mismas filas para siempre. Con el id desempata y el orden es total: (instante, id) de mayor a menor.
 */
export interface CursorKey {
  at: Date;
  id: string;
}

export const encodeCursor = (k: CursorKey): string => `${k.at.toISOString()}|${k.id}`;

/** `<ISO>|<id>` → clave. Cualquier cosa que no tenga esa forma se ignora (primera página) en vez de romper el pedido. */
export function decodeCursor(raw: string | undefined | null): CursorKey | null {
  if (!raw) return null;
  const cut = raw.indexOf('|');
  if (cut < 1) return null;
  const at = new Date(raw.slice(0, cut));
  const id = raw.slice(cut + 1);
  return Number.isNaN(at.getTime()) || !/^[a-z]?:?[0-9a-f-]{36}$/.test(id) ? null : { at, id };
}

/**
 * «Viene después del cursor» para UNA tabla de origen. El orden entre tablas es el de la cadena `id` del evento (`a:`, `l:`,
 * `p:`, `r:` + uuid): a igual instante, una tabla cuyo prefijo es MENOR que el del cursor entra entera, la del mismo prefijo
 * entra con id menor, y las de prefijo mayor ya se entregaron.
 */
export function keysetWhere(field: string, prefix: string, cur: CursorKey | null): Record<string, unknown> {
  if (!cur) return {};
  const [curPrefix = '', curRow = ''] = cur.id.includes(':') ? [cur.id.slice(0, cur.id.indexOf(':') + 1), cur.id.slice(cur.id.indexOf(':') + 1)] : ['', cur.id];
  const ties =
    prefix < curPrefix
      ? [{ [field]: cur.at }]
      : prefix === curPrefix
        ? [{ AND: [{ [field]: cur.at }, { id: { lt: curRow } }] }]
        : [];
  return { OR: [{ [field]: { lt: cur.at } }, ...ties] };
}

export const PAGE_DEFAULT = 30;
export const PAGE_MAX = 100;

/** El tamaño de página que pidió el cliente, acotado: nadie pide mil filas de una. */
export function pageLimit(requested: number): number {
  return Number.isInteger(requested) && requested > 0 ? Math.min(requested, PAGE_MAX) : PAGE_DEFAULT;
}

/** Una acción que **cambió algo** en el panel. Ver una ficha (`PII_REVEAL`) y un cobro (ya cuenta como pago) no son «acciones». */
function isAdminAction(a: { entity: string; action: string }): boolean {
  return a.action !== 'PII_REVEAL' && !(a.entity === 'payment' && a.action === 'CREATE');
}

const CLIENT_NAME = { firstName: true, lastName: true, businessName: true } as const;

@Injectable()
export class MemberDetailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  private tx<T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.prisma.withTenant(this.tenant.accountId, fn);
  }

  /** La membresía de ESTE tenant. Que sea de otra cuenta es un 404 (no se confirma que existe). */
  private async membership(tx: PrismaClient, userId: string) {
    const member = await tx.userAccount.findFirst({
      where: { userId, accountId: this.tenant.accountId },
      include: MEMBER_DETAIL_INCLUDE,
    });
    if (!member) throw memberNotFound();
    return member;
  }

  async detail(userId: string) {
    return this.tx(async (tx) => {
      const m = await this.membership(tx, userId);
      return {
        ...serializeMember(m),
        joinedAt: m.joinedAt.toISOString(),
        // Sólo lectura: las oficinas se administran en otra parte, no desde la ficha de un miembro.
        branchName: m.branch?.name ?? null,
      };
    });
  }

  /**
   * Los números del período. `PII_REVEAL` (que alguien abrió una ficha) queda **fuera de «acciones»**: es lectura y
   * en la base pesa cientos de filas por cada cambio real. Sí cuenta para «días activos»: abrir pantallas también es usar el panel.
   */
  async activity(userId: string, requestedDays: number): Promise<MemberActivity> {
    const days = (ACTIVITY_PERIODS as readonly number[]).includes(requestedDays) ? requestedDays : DEFAULT_PERIOD;
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.tx(async (tx) => {
      const m = await this.membership(tx, userId);
      const accountId = this.tenant.accountId;
      const account = await tx.account.findFirst({ where: { id: accountId }, select: { timezone: true } });
      const tz = account?.timezone ?? 'America/La_Paz';
      const kind: ActivityKind = FIELD_ROLES.includes(m.role.name) ? 'field' : 'admin';

      const [sessions, audits, activities, payments, routes] = await Promise.all([
        tx.userSession.findMany({ where: { userId, accountId, loginAt: { gte: from } }, select: { loginAt: true }, take: 20000 }),
        tx.auditLog.findMany({ where: { accountId, userId, createdAt: { gte: from } }, select: { createdAt: true, entity: true, action: true }, take: 20000 }),
        tx.creditActivity.findMany({
          where: { accountId, userId, createdAt: { gte: from }, type: { not: CreditActivityType.ASSIGNMENT } },
          select: { createdAt: true },
          take: 20000,
        }),
        tx.payment.findMany({ where: { accountId, registeredBy: userId, createdAt: { gte: from } }, select: { createdAt: true }, take: 20000 }),
        tx.routePlan.findMany({
          where: { accountId, collectorId: userId, status: RouteStatus.COMPLETED, completedAt: { gte: from } },
          select: { completedAt: true },
          take: 20000,
        }),
      ]);
      const stamps: Date[] = [
        ...sessions.map((s) => s.loginAt),
        ...audits.map((a) => a.createdAt),
        ...activities.map((a) => a.createdAt),
        ...payments.map((p) => p.createdAt),
      ];
      const metrics: Record<string, number> =
        kind === 'field'
          ? { activities: activities.length, payments: payments.length, routes: routes.length }
          : { actions: audits.filter(isAdminAction).length, payments: payments.length, logins: sessions.length };
      metrics.activeDays = distinctDays(stamps, tz);
      return { days, kind, metrics };
    });
  }

  /**
   * La lista cronológica, de a páginas, **de la más nueva a la más vieja**. Mezcla tres tablas (gestiones, pagos, rutas) y,
   * para quien no trabaja la cartera, sus acciones en el panel; por eso el cursor es el **instante** del último evento y no un
   * offset: cada fuente se pide con `at <= cursor` y `limit + 1` filas, y el servidor se queda con las `limit` más nuevas.
   * Un evento que cae justo en el borde puede venir en dos páginas: por eso cada uno trae un `id` y el cliente descarta repetidos.
   */
  async activityEvents(userId: string, requestedDays: number, before: CursorKey | null, requestedLimit: number): Promise<CursorPage<ActivityEvent>> {
    const days = (ACTIVITY_PERIODS as readonly number[]).includes(requestedDays) ? requestedDays : DEFAULT_PERIOD;
    const limit = pageLimit(requestedLimit);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.tx(async (tx) => {
      const m = await this.membership(tx, userId);
      const accountId = this.tenant.accountId;
      const take = limit + 1;
      const isAdmin = !FIELD_ROLES.includes(m.role.name);

      const [activities, payments, routes, audits] = await Promise.all([
        tx.creditActivity.findMany({
          where: { accountId, userId, createdAt: { gte: from }, ...keysetWhere('createdAt', 'a:', before), type: { not: CreditActivityType.ASSIGNMENT } },
          select: { id: true, createdAt: true, type: true, client: { select: CLIENT_NAME } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        tx.payment.findMany({
          where: { accountId, registeredBy: userId, createdAt: { gte: from }, ...keysetWhere('createdAt', 'p:', before) },
          select: { id: true, createdAt: true, credit: { select: { client: { select: CLIENT_NAME } } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        tx.routePlan.findMany({
          where: { accountId, collectorId: userId, status: RouteStatus.COMPLETED, completedAt: { gte: from }, ...keysetWhere('completedAt', 'r:', before) },
          select: { id: true, completedAt: true },
          orderBy: [{ completedAt: 'desc' }, { id: 'desc' }],
          take,
        }),
        isAdmin
          ? tx.auditLog.findMany({
              where: { accountId, userId, createdAt: { gte: from }, ...keysetWhere('createdAt', 'l:', before), action: { not: 'PII_REVEAL' }, NOT: { entity: 'payment', action: 'CREATE' } },
              select: { id: true, createdAt: true, entity: true, action: true },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take,
            })
          : Promise.resolve([]),
      ]);

      const all: ActivityEvent[] = [
        ...activities.map((a): ActivityEvent => ({ id: `a:${a.id}`, type: 'ACTIVITY', at: a.createdAt.toISOString(), code: a.type, clientName: clientName(a.client) })),
        ...payments.map((p): ActivityEvent => ({ id: `p:${p.id}`, type: 'PAYMENT', at: p.createdAt.toISOString(), code: 'PAYMENT', clientName: clientName(p.credit?.client) })),
        ...routes.map((r): ActivityEvent => ({ id: `r:${r.id}`, type: 'ROUTE', at: r.completedAt!.toISOString(), code: 'ROUTE' })),
        ...audits.map((a): ActivityEvent => ({ id: `l:${a.id}`, type: 'ADMIN', at: a.createdAt.toISOString(), code: `${a.entity}.${a.action}` })),
      ].sort((x, y) => (x.at === y.at ? (x.id < y.id ? 1 : -1) : x.at < y.at ? 1 : -1));

      const items = all.slice(0, limit);
      const last = items[items.length - 1];
      return { items, nextCursor: all.length > limit && last ? encodeCursor({ at: new Date(last.at), id: last.id }) : null };
    });
  }

  async connections(userId: string, before: CursorKey | null, requestedLimit: number): Promise<CursorPage<MemberConnection>> {
    const limit = pageLimit(requestedLimit);
    return this.tx(async (tx) => {
      await this.membership(tx, userId);
      const rows = await tx.userSession.findMany({
        where: { userId, accountId: this.tenant.accountId, ...keysetWhere('loginAt', '', before) },
        orderBy: [{ loginAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
      const page = rows.slice(0, limit);
      return {
        items: page.map((s) => {
          const ua = parseUserAgent(s.deviceInfo);
          return {
            id: s.id,
            loginAt: s.loginAt.toISOString(),
            deviceType: s.deviceType,
            browser: ua.browser,
            os: s.os ?? ua.os,
            ip: maskIp(s.ipAddress),
            city: s.city,
            country: s.country,
            result: 'SUCCESS' as const,
          };
        }),
        nextCursor: rows.length > limit ? encodeCursor({ at: page[page.length - 1]!.loginAt, id: page[page.length - 1]!.id }) : null,
      };
    });
  }

  /**
   * Los cambios de **esta cuenta de usuario**, traducidos a eventos. `audit_logs` guarda `UPDATE` con
   * `before`/`after`: lo que cambió se deduce comparando, y por eso sólo aparecen los cambios que ya
   * traen esos datos. Una fila que no se sabe leer se omite en vez de inventar un evento.
   *
   * ⚠️ `entityId` de `user_account` es el id de la **membresía**, no el del usuario; la aceptación de
   * la invitación (`entity: 'user'`) sí lleva el id del usuario.
   */
  async audit(userId: string): Promise<MemberAuditEvent[]> {
    return this.tx(async (tx) => {
      const m = await this.membership(tx, userId);
      const rows = await tx.auditLog.findMany({
        where: {
          accountId: this.tenant.accountId,
          OR: [
            { entity: 'user_account', entityId: m.id },
            { entity: 'user', entityId: userId },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const roleIds = new Set<string>();
      for (const r of rows) {
        for (const j of [asJson(r.before), asJson(r.after)]) if (typeof j?.roleId === 'string') roleIds.add(j.roleId);
      }
      const roles = await tx.role.findMany({ where: { id: { in: [...roleIds] } }, select: { id: true, name: true } });
      const roleName = (id: unknown) => roles.find((x) => x.id === id)?.name ?? null;
      const actors = await tx.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.userId))] } },
        select: { id: true, email: true, profile: { select: { firstName: true, lastName: true } } },
      });
      const actorName = (id: string) => {
        const a = actors.find((x) => x.id === id);
        if (!a) return null;
        return [a.profile?.firstName, a.profile?.lastName].filter(Boolean).join(' ') || a.email;
      };

      const out: MemberAuditEvent[] = [];
      for (const r of rows) {
        const before = asJson(r.before);
        const after = asJson(r.after);
        const at = r.createdAt.toISOString();
        const by = actorName(r.userId);
        const push = (event: string, detail: MemberAuditEvent['detail'] = {}) =>
          out.push({ id: `${r.id}:${event}`, at, event, detail, actorName: by });

        if (r.entity === 'user') {
          if (after?.invitationAccepted) push('INVITATION_ACCEPTED');
          continue;
        }
        if (r.action === 'CREATE' && after?.invited) {
          push('INVITED', { role: roleName(after.roleId) });
        } else if (r.action === 'REASSIGN_ON_DEACTIVATE') {
          push('WORK_REASSIGNED', {
            credits: Number(after?.credits ?? 0),
            agenda: Number(after?.agenda ?? 0),
            routes: Number(after?.routes ?? 0),
          });
        } else if (r.action === 'UPDATE') {
          if (after?.invitationResent) push('INVITATION_RESENT');
          if (before && after && before.roleId !== after.roleId) {
            push('ROLE_CHANGED', { from: roleName(before.roleId), to: roleName(after.roleId) });
          }
          if (before && after && before.isActive !== after.isActive) push(after.isActive ? 'REACTIVATED' : 'DEACTIVATED');
        }
      }
      return out;
    });
  }
}
