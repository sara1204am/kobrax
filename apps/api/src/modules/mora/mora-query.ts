import { Prisma, type PrismaClient } from '@prisma/client';
import { CasePriority, CaseStatus } from '@prisma/client';
import { MORA_SORTS, Permission, searchTerms, type MoraSort } from '@kobrax/shared';
import { enumList } from '../cases/cases.service';
import type { ListMoraQueryDto } from './dto/mora.dto';

/**
 * El listado de Mora se arma en SQL y no con `findMany` de Prisma porque **ordena por columnas de dos
 * tablas distintas** (el crédito y su caso abierto) y el caso es una relación 1-a-muchos para Prisma,
 * que no sabe ordenar por ella. El índice único parcial `collection_cases_account_credit_open_key`
 * garantiza que hay **a lo sumo un** caso abierto por crédito, así que el `LEFT JOIN` no duplica filas.
 *
 * Este módulo devuelve sólo fragmentos (`Prisma.Sql`): no ejecuta nada, y por eso se prueba sin base.
 * Todo valor del usuario va como parámetro; lo único que se interpola es de listas cerradas.
 */

const TERMINAL = [CaseStatus.CLOSED, CaseStatus.WRITTEN_OFF] as string[];

/** Quién consulta: decide el alcance. El cobrador (escribe casos pero no los reparte) ve sólo los suyos. */
export interface MoraScope {
  accountId: string;
  userId?: string;
  /** `case:write` sin `case:assign` (el cobrador). Ve únicamente sus casos. */
  ownOnly: boolean;
  /** Puede filtrar por cualquier cobrador y por «sin asignar». */
  canAssign: boolean;
}

/** `%` y `_` del texto del usuario son literales, no comodines. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

/** Fecha `YYYY-MM-DD` de hoy en UTC (la misma regla que `clientsWithPromise`). */
function todayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * **Quién puede ver qué**, sin ningún filtro de pantalla: el tenant, que el crédito no esté borrado y, para
 * el cobrador, que el caso abierto sea suyo. Lo comparten el listado y la ficha, para que un crédito que
 * la lista no le muestra a alguien tampoco se pueda abrir por la URL.
 */
export function moraAccessConditions(scope: MoraScope): Prisma.Sql[] {
  const c: Prisma.Sql[] = [Prisma.sql`cr.account_id = ${scope.accountId}`, Prisma.sql`cr.deleted_at IS NULL`];
  // El cobrador ve lo suyo: el crédito que tiene a su cargo (responsable, temporal o apoyo vigentes) o, mientras
  // el caso viejo exista, el caso que tiene asignado. Un crédito AL DÍA a su cargo también es suyo (F4/08).
  if (scope.ownOnly) {
    const me = scope.userId ?? '';
    c.push(Prisma.sql`(
      cr.assigned_manager_id = ${me}
      OR cc.assignee_id = ${me}
      OR EXISTS (
        SELECT 1 FROM credit_assignments ca
        WHERE ca.credit_id = cr.id AND ca.account_id = cr.account_id AND ca.user_id = ${me}
          AND ca.revoked_at IS NULL AND ca.starts_at <= now() AND (ca.expires_at IS NULL OR ca.expires_at > now())))`);
  }
  return c;
}

/** El alcance de quien consulta, por **capacidad** (no por nombre de rol). Lo comparten Mora y Agenda. */
export function moraScopeOf(tenant: { accountId: string; userId?: string; can(permission: string): boolean }): MoraScope {
  const canAssign = tenant.can(Permission.CASE_ASSIGN);
  return { accountId: tenant.accountId, userId: tenant.userId, ownOnly: tenant.can(Permission.CASE_WRITE) && !canAssign, canAssign };
}

/**
 * Los créditos que `scope` puede ver (mismo alcance que la ficha de mora), por id o por cliente. Los que no se
 * ven no aparecen: quien llama decide el 404.
 */
export async function visibleCredits(
  tx: Pick<PrismaClient, '$queryRaw'>,
  scope: MoraScope,
  filter: { creditId?: string; clientId?: string },
): Promise<{ id: string; clientId: string }[]> {
  const extra: Prisma.Sql[] = [];
  if (filter.creditId) extra.push(Prisma.sql`cr.id = ${filter.creditId}`);
  if (filter.clientId) extra.push(Prisma.sql`cr.client_id = ${filter.clientId}`);
  const access = Prisma.join([...moraAccessConditions(scope), ...extra], ' AND ');
  const rows = await tx.$queryRaw<{ id: string; client_id: string }[]>(Prisma.sql`SELECT cr.id, cr.client_id ${MORA_FROM} WHERE ${access}`);
  return rows.map((r) => ({ id: r.id, clientId: r.client_id }));
}

/**
 * Las condiciones del `WHERE`, unidas con `AND`. Alias fijos: `cr` crédito, `cl` cliente, `cc` caso abierto.
 */
export function buildMoraWhere(query: ListMoraQueryDto, scope: MoraScope, now: Date = new Date()): Prisma.Sql {
  const c: Prisma.Sql[] = moraAccessConditions(scope);

  // Un crédito de Kobrax en mora está ACTIVE; uno de fuente externa que el archivo marcó vencido está DEFAULTED.
  c.push(Prisma.sql`(cr.status::text = 'ACTIVE' OR (cr.status::text = 'DEFAULTED' AND cr.external_source IS NOT NULL))`);

  const includeCurrent = query.todos === 'true';
  // Una operación externa ausente del último reporte no está «al día» ni «en mora»: no se lista (D4).
  if (!includeCurrent) c.push(Prisma.sql`(cr.sync_status IS NULL OR cr.sync_status::text <> 'ABSENT')`);

  // Por defecto sólo los que están en mora. `dpdMin` explícito manda sobre el default.
  const dpdMin = query.dpdMin ?? (includeCurrent ? undefined : 1);
  if (dpdMin != null) c.push(Prisma.sql`cr.days_past_due >= ${dpdMin}`);
  if (query.dpdMax != null) c.push(Prisma.sql`cr.days_past_due <= ${query.dpdMax}`);
  if (query.balanceMin != null) c.push(Prisma.sql`cr.outstanding_balance >= ${query.balanceMin}`);
  if (query.balanceMax != null) c.push(Prisma.sql`cr.outstanding_balance <= ${query.balanceMax}`);
  if (query.branchId) c.push(Prisma.sql`cr.branch_id = ${query.branchId}`);

  if (query.source === 'KOBRAX') c.push(Prisma.sql`cr.external_source IS NULL`);
  else if (query.source) c.push(Prisma.sql`cr.external_source = ${query.source}`);

  // Misma regla que `arrearsSourceOf`: externo → IMPORTED; si no, MANUAL si alguien declaró `moraSince`.
  if (query.arrearsSource === 'IMPORTED') {
    c.push(Prisma.sql`cr.origin::text IN ('IMPORT', 'API')`);
  } else if (query.arrearsSource === 'MANUAL') {
    c.push(Prisma.sql`cr.origin::text NOT IN ('IMPORT', 'API') AND (cr.metadata->>'moraSince') IS NOT NULL`);
  } else if (query.arrearsSource === 'CALCULATED') {
    c.push(Prisma.sql`cr.origin::text NOT IN ('IMPORT', 'API') AND (cr.metadata->>'moraSince') IS NULL`);
  }

  // ── Caso abierto ──────────────────────────────────────────────────────────
  if (!scope.ownOnly && scope.canAssign) {
    if (query.assigneeId) c.push(Prisma.sql`cc.assignee_id = ${query.assigneeId}`);
    if (query.unassigned === 'true') c.push(Prisma.sql`cc.id IS NOT NULL AND cc.assignee_id IS NULL`);
  }
  if (query.hasCase === 'true') c.push(Prisma.sql`cc.id IS NOT NULL`);
  if (query.hasCase === 'false') c.push(Prisma.sql`cc.id IS NULL`);

  const priorities = enumList(query.priority, CasePriority);
  if (priorities.length > 0) c.push(Prisma.sql`cc.priority::text = ANY(${priorities as string[]}::text[])`);
  const statuses = enumList(query.status, CaseStatus);
  if (statuses.length > 0) c.push(Prisma.sql`cc.status::text = ANY(${statuses as string[]}::text[])`);
  if (query.overdue === 'true') c.push(Prisma.sql`cc.sla_due_at < ${now}`);
  if (query.noActionSince) c.push(Prisma.sql`(cc.last_action_at IS NULL OR cc.last_action_at < ${query.noActionSince}::date)`);

  // Promesa vigente: la misma definición que `clientsWithPromise` (agendada para hoy o adelante, sin ejecutar).
  if (query.hasPromise === 'true' || query.hasPromise === 'false') {
    const exists = Prisma.sql`EXISTS (
      SELECT 1 FROM agenda_items a
      WHERE a.client_id = cr.client_id AND a.account_id = cr.account_id AND a.deleted_at IS NULL
        AND a.type::text = 'PROMISE_TO_PAY' AND a.status::text = 'SCHEDULED'
        AND a.scheduled_date >= ${todayIso(now)}::date)`;
    c.push(query.hasPromise === 'true' ? exists : Prisma.sql`NOT ${exists}`);
  }

  // ── Búsqueda: nº de crédito, nombre (palabra por palabra) o zona, en la misma caja ──
  const q = query.q?.trim();
  if (q) {
    const terms = searchTerms(q);
    const byName = terms.map((t) => {
      const like = `%${escapeLike(t)}%`;
      return Prisma.sql`(cl.first_name ILIKE ${like} OR cl.last_name ILIKE ${like} OR cl.business_name ILIKE ${like})`;
    });
    const likeFull = `%${escapeLike(q)}%`;
    const alternatives: Prisma.Sql[] = [
      Prisma.sql`cr.code ILIKE ${likeFull}`,
      Prisma.sql`EXISTS (SELECT 1 FROM client_locations l WHERE l.client_id = cl.id AND l.zone ILIKE ${likeFull})`,
    ];
    if (byName.length > 0) alternatives.push(Prisma.sql`(${Prisma.join(byName, ' AND ')})`);
    c.push(Prisma.sql`(${Prisma.join(alternatives, ' OR ')})`);
  }
  // El filtro de zona del panel es aparte y exacto: «Centro» no trae «Centro Norte».
  if (query.zone?.trim()) {
    c.push(Prisma.sql`EXISTS (SELECT 1 FROM client_locations l WHERE l.client_id = cl.id AND l.zone = ${query.zone.trim()})`);
  }

  return Prisma.join(c, ' AND ');
}

/** Rango de la prioridad del caso para ordenar (crítica primero en descendente). Sin caso → NULL. */
const PRIORITY_RANK = Prisma.raw(
  `CASE cc.priority::text WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 END`,
);

const ORDER_EXPR: Record<MoraSort, Prisma.Sql> = {
  daysPastDue: Prisma.raw('cr.days_past_due'),
  balance: Prisma.raw('cr.outstanding_balance'),
  priority: PRIORITY_RANK,
  lastAction: Prisma.raw('cc.last_action_at'),
  slaDueAt: Prisma.raw('cc.sla_due_at'),
  createdAt: Prisma.raw('cr.created_at'),
};

/**
 * El `ORDER BY`. Los nulos van **siempre al final** (un crédito sin caso no «gana» por no tener prioridad),
 * y cierra con `id` para que `LIMIT/OFFSET` no repita ni saltee filas entre páginas cuando hay empates.
 *
 * Una clave desconocida cae al default (`daysPastDue` desc): `Object.hasOwn` y no un lookup simple, para
 * que `?sort=hasOwnProperty` no encuentre un miembro heredado de `Object.prototype`.
 */
export function buildMoraOrder(sort?: string, dir?: string): Prisma.Sql {
  const key: MoraSort = sort && (MORA_SORTS as readonly string[]).includes(sort) && Object.hasOwn(ORDER_EXPR, sort) ? (sort as MoraSort) : 'daysPastDue';
  const direction = Prisma.raw(dir === 'asc' ? 'ASC' : 'DESC');
  const parts: Prisma.Sql[] = [Prisma.sql`${ORDER_EXPR[key]} ${direction} NULLS LAST`];
  // Entre iguales, el de más mora primero: es el que más urge.
  if (key !== 'daysPastDue') parts.push(Prisma.raw('cr.days_past_due DESC'));
  parts.push(Prisma.raw('cr.id ASC'));
  return Prisma.join(parts, ', ');
}

export { TERMINAL as TERMINAL_CASE_STATUSES };

/** El `FROM … JOIN` común al listado y al conteo. */
export const MORA_FROM = Prisma.sql`
  FROM credits cr
  JOIN clients cl ON cl.id = cr.client_id
  LEFT JOIN collection_cases cc
    ON cc.credit_id = cr.id AND cc.account_id = cr.account_id
   AND cc.status::text NOT IN ('CLOSED', 'WRITTEN_OFF') AND cc.deleted_at IS NULL`;
