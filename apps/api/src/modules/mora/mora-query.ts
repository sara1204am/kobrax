import { Prisma, type PrismaClient } from '@prisma/client';
import { CollectionPriority, VisitOutcome } from '@prisma/client';
import { MORA_SORTS, Permission, searchTerms, type ArrearRange, type MoraSort } from '@kobrax/shared';
import type { ListMoraQueryDto } from './dto/mora.dto';

/**
 * El listado de Mora se arma en SQL y no con `findMany` de Prisma porque **ordena por columnas de dos
 * tablas distintas** (el crédito y su episodio de mora abierto), y Prisma no sabe ordenar por una relación
 * 1-a-muchos. El índice único `credit_arrear_episodes_one_open_per_credit` garantiza que hay **a lo sumo
 * un** episodio abierto por crédito, así que el `LEFT JOIN` no duplica filas.
 *
 * F4/08: **ya no hay caso**. La fila es el crédito; la situación sale del episodio abierto, la prioridad es
 * la del episodio, el responsable es `credits.assigned_manager_id` (+ temporal/apoyo vigentes) y la
 * categoría de mora se calcula con los rangos de la cuenta (nunca se guarda).
 *
 * Este módulo devuelve sólo fragmentos (`Prisma.Sql`): no ejecuta nada, y por eso se prueba sin base.
 * Todo valor del usuario va como parámetro; lo único que se interpola es de listas cerradas.
 */

/** Hasta dónde ve quien consulta (D8). Sale del alcance de datos del rol, no de su nombre. */
export type MoraScopeKind = 'ALL' | 'BRANCH' | 'OWN';

/** Quién consulta: decide el alcance. */
export interface MoraScope {
  accountId: string;
  userId?: string;
  /**
   *  · `ALL`    — gerente, administrador, auditor, lector (`data:scope:all`): todo el tenant.
   *  · `BRANCH` — supervisor (`data:scope:branch`): los créditos con responsable de SU agencia + los suyos.
   *  · `OWN`    — cobrador (sin permiso de alcance): sólo lo que tiene a su cargo (responsable, temporal o apoyo).
   */
  kind: MoraScopeKind;
  /** `kind === 'OWN'`: lo suyo y nada más. */
  ownOnly: boolean;
  /** Puede filtrar por cualquier responsable y por «sin responsable» (todo menos el cobrador). */
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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** ¿Es una fecha de calendario real? (`2026-02-31` no.) */
function isRealDay(raw: string): boolean {
  if (!ISO_DAY.test(raw)) return false;
  const d = new Date(`${raw}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw;
}

/** `excludeRouted`: `'true'` = hoy, `YYYY-MM-DD` = esa fecha; cualquier otra cosa no filtra (`null`). */
export function routedDay(raw: string | undefined, now: Date): string | null {
  const v = raw?.trim();
  if (!v) return null;
  if (v === 'true') return todayIso(now);
  return isRealDay(v) ? v : null;
}

/**
 * `notVisitedSince`: `YYYY-MM-DD` (inicio de ese día, UTC) o un entero de días hacia atrás desde `now`
 * (`0` = desde ahora: ninguna visita futura, es decir, no filtra nada útil; `1..3650` válidos). Lo demás: `null`.
 */
export function visitCutoff(raw: string | undefined, now: Date): Date | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^\d{1,4}$/.test(v)) {
    const days = Number(v);
    return days >= 1 && days <= 3650 ? new Date(now.getTime() - days * 86_400_000) : null;
  }
  return isRealDay(v) ? new Date(`${v}T00:00:00.000Z`) : null;
}

/** Valores válidos de una lista separada por comas; lo desconocido se descarta (no es un 400). */
function enumList<T extends Record<string, string>>(raw: string | undefined, values: T): T[keyof T][] {
  if (!raw?.trim()) return [];
  const valid = new Set(Object.values(values));
  const out = raw
    .split(',')
    .map((v) => v.trim())
    .filter((v) => valid.has(v));
  return [...new Set(out)] as T[keyof T][];
}

/** Una categoría de mora de la cuenta tal como la usa el filtro (código + rango). */
export interface MoraCategoryRange extends ArrearRange {
  name: string;
  color: string | null;
  code: string;
}

/** Los códigos de categoría pedidos (`A,B`), sin repetir ni vacíos. */
export function categoryCodes(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [...new Set(raw.split(',').map((c) => c.trim()).filter((c) => c.length > 0))];
}

/**
 * «Este usuario tiene a cargo el crédito `cr`»: responsable o una asignación vigente. `kinds` acota el tipo
 * (el filtro de la pantalla mira sólo TEMPORAL/APOYO porque el principal ya es `assigned_manager_id`).
 */
function assignedTo(user: string, kinds?: readonly string[]): Prisma.Sql {
  const kind = kinds ? Prisma.sql`AND ca.kind::text = ANY(${kinds as string[]}::text[])` : Prisma.empty;
  return Prisma.sql`EXISTS (
        SELECT 1 FROM credit_assignments ca
        WHERE ca.credit_id = cr.id AND ca.account_id = cr.account_id AND ca.user_id = ${user} ${kind}
          AND ca.revoked_at IS NULL AND ca.starts_at <= now() AND (ca.expires_at IS NULL OR ca.expires_at > now()))`;
}

/**
 * **Quién puede ver qué**, sin ningún filtro de pantalla: el tenant, que el crédito no esté borrado y el
 * alcance (D8). Lo comparten el listado, la ficha y la agenda, para que un crédito que la lista no le muestra
 * a alguien tampoco se pueda abrir por la URL.
 *
 *  · `ALL`: nada más.
 *  · `OWN`: los créditos a su cargo (responsable, temporal o apoyo vigentes).
 *  · `BRANCH`: los suyos **más** los de su agencia (`user_accounts.branch_id`) **que tienen responsable**.
 *    Un crédito sin responsable sólo lo ve quien tiene alcance total: nadie de la agencia lo está atendiendo.
 *    Un supervisor sin agencia asignada no ve ninguna (`branch_id = NULL` no es igual a nada): sólo lo suyo.
 */
export function moraAccessConditions(scope: MoraScope): Prisma.Sql[] {
  const c: Prisma.Sql[] = [Prisma.sql`cr.account_id = ${scope.accountId}`, Prisma.sql`cr.deleted_at IS NULL`];
  if (scope.kind === 'ALL') return c;

  const me = scope.userId ?? '';
  const mine = Prisma.sql`(cr.assigned_manager_id = ${me} OR ${assignedTo(me)})`;
  if (scope.kind === 'OWN') {
    c.push(mine);
  } else {
    c.push(Prisma.sql`(${mine}
      OR (cr.assigned_manager_id IS NOT NULL AND cr.branch_id IS NOT NULL AND cr.branch_id = (
        SELECT ua.branch_id FROM user_accounts ua
        WHERE ua.user_id = ${me} AND ua.account_id = cr.account_id AND ua.is_active = true
        LIMIT 1)))`);
  }
  return c;
}

/**
 * El alcance de quien consulta, por **capacidad** (no por nombre de rol). Lo comparten Mora y Agenda.
 * `data:scope:all` → todo; `data:scope:branch` → su agencia; ninguno → lo suyo (falla cerrado).
 */
export function moraScopeOf(tenant: { accountId: string; userId?: string; can(permission: string): boolean }): MoraScope {
  const kind: MoraScopeKind = tenant.can(Permission.DATA_SCOPE_ALL) ? 'ALL' : tenant.can(Permission.DATA_SCOPE_BRANCH) ? 'BRANCH' : 'OWN';
  return { accountId: tenant.accountId, userId: tenant.userId, kind, ownOnly: kind === 'OWN', canAssign: kind !== 'OWN' };
}

/** Sólo el crédito, para consultas de alcance que no necesitan ni el cliente ni el episodio. */
export const MORA_ACCESS_FROM = Prisma.sql`FROM credits cr`;

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
  const rows = await tx.$queryRaw<{ id: string; client_id: string }[]>(Prisma.sql`SELECT cr.id, cr.client_id ${MORA_ACCESS_FROM} WHERE ${access}`);
  return rows.map((r) => ({ id: r.id, clientId: r.client_id }));
}

/**
 * Las condiciones del `WHERE`, unidas con `AND`. Alias fijos: `cr` crédito, `cl` cliente, `ep` episodio abierto.
 * `categories` son los rangos de la cuenta (una consulta por request); sin ellos el filtro `category` no hace nada.
 */
export function buildMoraWhere(
  query: ListMoraQueryDto,
  scope: MoraScope,
  now: Date = new Date(),
  categories: readonly MoraCategoryRange[] = [],
): Prisma.Sql {
  const c: Prisma.Sql[] = moraAccessConditions(scope);

  const onlyWrittenOff = query.writtenOff === 'true';
  // Un crédito de Kobrax en mora está ACTIVE; uno de fuente externa que el archivo marcó vencido está DEFAULTED.
  // El castigo es una condición aparte (`written_off_at`): sólo se pide explícitamente con `writtenOff=true`.
  const live = Prisma.sql`(cr.status::text = 'ACTIVE' OR (cr.status::text = 'DEFAULTED' AND cr.external_source IS NOT NULL))`;
  c.push(onlyWrittenOff ? Prisma.sql`(${live} OR cr.written_off_at IS NOT NULL)` : live);

  const includeCurrent = query.todos === 'true';
  // Una operación externa ausente del último reporte no está «al día» ni «en mora»: no se lista (D9).
  if (!includeCurrent) c.push(Prisma.sql`(cr.sync_status IS NULL OR cr.sync_status::text <> 'ABSENT')`);

  // Por defecto sólo los que están en mora. `dpdMin` explícito manda sobre el default; pedir los castigados
  // los trae a todos (un castigado puede estar sin días de mora).
  const dpdMin = query.dpdMin ?? (includeCurrent || onlyWrittenOff ? undefined : 1);
  if (dpdMin != null) c.push(Prisma.sql`cr.days_past_due >= ${dpdMin}`);
  if (query.dpdMax != null) c.push(Prisma.sql`cr.days_past_due <= ${query.dpdMax}`);
  if (query.balanceMin != null) c.push(Prisma.sql`cr.outstanding_balance >= ${query.balanceMin}`);
  if (query.balanceMax != null) c.push(Prisma.sql`cr.outstanding_balance <= ${query.balanceMax}`);
  if (query.branchId) c.push(Prisma.sql`cr.branch_id = ${query.branchId}`);

  if (query.writtenOff === 'true') c.push(Prisma.sql`cr.written_off_at IS NOT NULL`);
  else if (query.writtenOff === 'false') c.push(Prisma.sql`cr.written_off_at IS NULL`);

  // Categoría: se traduce a su rango de días con la configuración vigente. Un código que la cuenta no tiene
  // (un enlace viejo) se ignora, como cualquier filtro desconocido; si ninguno existe, no se filtra.
  const ranges = categoryCodes(query.category)
    .map((code) => categories.find((cat) => cat.code === code))
    .filter((cat): cat is MoraCategoryRange => cat !== undefined)
    .map((cat) =>
      cat.toDays === null
        ? Prisma.sql`cr.days_past_due >= ${cat.fromDays}`
        : Prisma.sql`(cr.days_past_due >= ${cat.fromDays} AND cr.days_past_due <= ${cat.toDays})`,
    );
  if (ranges.length > 0) c.push(Prisma.sql`(${Prisma.join(ranges, ' OR ')})`);

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

  // ── Responsable (el cobrador no puede ampliar su alcance con esto) ────────
  if (scope.canAssign) {
    if (query.assigneeId) {
      c.push(Prisma.sql`(cr.assigned_manager_id = ${query.assigneeId} OR ${assignedTo(query.assigneeId, ['TEMPORAL', 'APOYO'])})`);
    }
    if (query.unassigned === 'true') c.push(Prisma.sql`cr.assigned_manager_id IS NULL`);
  }

  // ── Episodio abierto: la prioridad es suya ────────────────────────────────
  const priorities = enumList(query.priority, CollectionPriority);
  if (priorities.length > 0) c.push(Prisma.sql`ep.priority::text = ANY(${priorities as string[]}::text[])`);

  // Promesa vigente: la misma definición que `clientsWithPromise` (agendada para hoy o adelante, sin ejecutar).
  if (query.hasPromise === 'true' || query.hasPromise === 'false') {
    const exists = Prisma.sql`EXISTS (
      SELECT 1 FROM agenda_items a
      WHERE a.client_id = cr.client_id AND a.account_id = cr.account_id AND a.deleted_at IS NULL
        AND a.type::text = 'PROMISE_TO_PAY' AND a.status::text = 'SCHEDULED'
        AND a.scheduled_date >= ${todayIso(now)}::date)`;
    c.push(query.hasPromise === 'true' ? exists : Prisma.sql`NOT ${exists}`);
  }

  // ── Planificación de rutas: visitas y paradas POR CRÉDITO ─────────────────
  const visits = Prisma.sql`SELECT 1 FROM field_visits v WHERE v.credit_id = cr.id AND v.account_id = cr.account_id`;
  if (query.neverVisited === 'true') {
    c.push(Prisma.sql`NOT EXISTS (${visits})`);
  } else {
    // «Nunca» es un subconjunto de «no desde»: si se pidió el primero, el segundo sobra.
    const cutoff = visitCutoff(query.notVisitedSince, now);
    if (cutoff) c.push(Prisma.sql`NOT EXISTS (${visits} AND v.captured_at >= ${cutoff})`);
  }

  // Resultado de la ÚLTIMA visita (la más reciente; el id desempata dos del mismo instante).
  const outcomes = enumList(query.outcome, VisitOutcome);
  if (outcomes.length > 0) {
    c.push(Prisma.sql`(
      SELECT v.outcome::text FROM field_visits v
      WHERE v.credit_id = cr.id AND v.account_id = cr.account_id
      ORDER BY v.captured_at DESC, v.id DESC LIMIT 1) = ANY(${outcomes as string[]}::text[])`);
  }

  // «Sólo mora disponible»: fuera los que ya son parada de una ruta viva ese día (una cancelada libera al crédito).
  const routed = routedDay(query.excludeRouted, now);
  if (routed) {
    c.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM route_stops rs JOIN route_plans rp ON rp.id = rs.route_id
      WHERE rs.credit_id = cr.id AND rs.account_id = cr.account_id
        AND rp.planned_date = ${routed}::date AND rp.status::text <> 'CANCELLED')`);
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

/** Rango de la prioridad del episodio abierto para ordenar (crítica primero en descendente). Al día → NULL. */
const PRIORITY_RANK = Prisma.raw(
  `CASE ep.priority::text WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 WHEN 'LOW' THEN 1 END`,
);

/**
 * `lastAction` y `slaDueAt` ya no existen (F4/08 · D2): no están acá y caen al default, igual que cualquier
 * clave desconocida, aunque `MORA_SORTS` (shared) las conserve hasta que la web deje de nombrarlas.
 */
const ORDER_EXPR: Partial<Record<MoraSort, Prisma.Sql>> = {
  daysPastDue: Prisma.raw('cr.days_past_due'),
  balance: Prisma.raw('cr.outstanding_balance'),
  priority: PRIORITY_RANK,
  createdAt: Prisma.raw('cr.created_at'),
};

/**
 * El `ORDER BY`. Los nulos van **siempre al final** (un crédito al día no «gana» por no tener prioridad),
 * y cierra con `id` para que `LIMIT/OFFSET` no repita ni saltee filas entre páginas cuando hay empates.
 *
 * Una clave desconocida cae al default (`daysPastDue` desc): `Object.hasOwn` y no un lookup simple, para
 * que `?sort=hasOwnProperty` no encuentre un miembro heredado de `Object.prototype`.
 */
export function buildMoraOrder(sort?: string, dir?: string): Prisma.Sql {
  const known = !!sort && (MORA_SORTS as readonly string[]).includes(sort) && Object.hasOwn(ORDER_EXPR, sort);
  const key: MoraSort = known ? (sort as MoraSort) : 'daysPastDue';
  const direction = Prisma.raw(dir === 'asc' ? 'ASC' : 'DESC');
  const parts: Prisma.Sql[] = [Prisma.sql`${ORDER_EXPR[key]!} ${direction} NULLS LAST`];
  // Entre iguales, el de más mora primero: es el que más urge.
  if (key !== 'daysPastDue') parts.push(Prisma.raw('cr.days_past_due DESC'));
  parts.push(Prisma.raw('cr.id ASC'));
  return Prisma.join(parts, ', ');
}

/** El `FROM … JOIN` común al listado y al conteo: crédito, cliente y su episodio de mora abierto (si lo hay). */
export const MORA_FROM = Prisma.sql`
  FROM credits cr
  JOIN clients cl ON cl.id = cr.client_id
  LEFT JOIN credit_arrear_episodes ep
    ON ep.credit_id = cr.id AND ep.account_id = cr.account_id AND ep.ended_at IS NULL`;
