/**
 * Oficinas (F13): los tipos de lo que devuelve `GET /branches` y la lógica PURA de la pantalla (filtrar el árbol,
 * qué nodos se ven, si un movimiento vale, por qué no se puede dar de baja). Lo del árbol en sí —`buildOfficeTree`,
 * `officeFullName`, `checkOfficeMove`— viene de `@kobrax/shared`: acá no se duplica.
 *
 * 🔴 La web NO decide alcance: la API ya limita lo que cada persona ve. Esto sólo ordena, filtra y avisa.
 */
import {
  buildOfficeTree,
  checkOfficeMove,
  officeSubtree,
  type MoveCheck,
  memberName,
  type Member,
  type OfficeTreeItem,
} from '@kobrax/shared';

/** Una oficina tal como la devuelve `GET /branches`. */
export interface OfficeRow {
  id: string;
  name: string;
  code: string | null;
  city: string | null;
  address: string | null;
  /** Punto en el mapa; van las dos o ninguna. */
  latitude?: number | null;
  longitude?: number | null;
  active: boolean;
  parentId: string | null;
  typeId: string | null;
  typeCode?: string;
  typeName: string | null;
  /** Ruta materializada: `/raíz/regional/agencia/`. */
  path: string;
  depth: number;
  isRoot: boolean;
  /** `Central › Chuquisaca › Mesa Verde` (R10). */
  fullName: string;
  managerUserId: string | null;
  managerName?: string | null;
  /** Miembros activos. */
  members: number;
  /** Créditos vivos de ESTA oficina (no del subárbol). */
  credits: number;
  /** Oficinas hijas vivas directas. */
  children?: number;
}

/** Un tipo del catálogo de la cuenta (`GET /branch-types`). */
export interface OfficeType {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface OfficeMemberRow {
  userId: string;
  name: string;
  email?: string | null;
  roleName?: string | null;
  /** Lo que esta persona tiene a su cargo en la oficina (y lo que cuelga de ella). */
  portfolio?: OfficePortfolio;
  /** La oficina en la que está asignada (en una regional, la de su agencia). */
  branchId?: string;
  branchName?: string;
}

export interface OfficeHistoryEvent {
  id: string;
  action: string;
  at: string;
  actorName: string | null;
  summary?: string | null;
  before?: unknown;
  after?: unknown;
}

export interface OfficeStats {
  members: number;
  credits: number;
  children: number;
  /** Créditos en mora de la oficina; `null` si el servidor no lo manda. */
  arrears: number | null;
}

/** La cartera viva de una oficina y de lo que cuelga de ella, por moneda. «En mora» suma el saldo adeudado, no la cuota. */
export interface OfficePortfolio {
  credits: number;
  arrearsCredits: number;
  byCurrency: { currency: string; credits: number; arrearsCredits: number; balance: number; arrearsBalance: number }[];
}

export interface OfficeDetail extends Omit<OfficeRow, 'members'> {
  membersCount: number;
  membersList: OfficeMemberRow[];
  stats: OfficeStats;
  portfolio: OfficePortfolio;
  history: OfficeHistoryEvent[];
}

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asNumber = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Sin cartera (o un servidor que todavía no la manda) es cartera vacía, no un error. */
function parsePortfolio(raw: unknown): OfficePortfolio {
  const r = (raw ?? {}) as Record<string, unknown>;
  const byCurrency = asArray<Record<string, unknown>>(r.byCurrency).map((c) => ({
    currency: typeof c.currency === 'string' ? c.currency : 'BOB',
    credits: asNumber(c.credits),
    arrearsCredits: asNumber(c.arrearsCredits),
    balance: asNumber(c.balance),
    arrearsBalance: asNumber(c.arrearsBalance),
  }));
  return { credits: asNumber(r.credits), arrearsCredits: asNumber(r.arrearsCredits), byCurrency };
}

/**
 * `GET /branches/:id` trae la fila más los miembros, las estadísticas y el historial. Se lee con tolerancia: `members`
 * puede venir como conteo (igual que en la lista) o como la lista misma, y las estadísticas pueden faltar.
 */
export function parseOfficeDetail(raw: Record<string, unknown>): OfficeDetail {
  const base = raw as unknown as OfficeRow;
  const list = asArray<OfficeMemberRow>(Array.isArray(raw.members) ? raw.members : raw.membersList).map((m) => ({
    ...m,
    portfolio: parsePortfolio((m as { portfolio?: unknown }).portfolio),
  }));
  const rawStats = (raw.stats ?? {}) as Record<string, unknown>;
  // El equipo es el del subárbol (la lista); el conteo plano de la oficina sólo es el de sus asignaciones directas.
  const membersCount = list.length > 0 ? list.length : typeof raw.members === 'number' ? raw.members : 0;
  return {
    ...base,
    membersCount,
    membersList: list,
    stats: {
      members: asNumber(rawStats.members, membersCount),
      credits: asNumber(rawStats.credits, asNumber(raw.credits)),
      children: asNumber(rawStats.children),
      arrears: typeof rawStats.arrears === 'number' ? rawStats.arrears : null,
    },
    portfolio: parsePortfolio(raw.portfolio),
    history: asArray<OfficeHistoryEvent>(raw.history ?? raw.audit),
  };
}

/** Las oficinas vigentes. */
export const activeOffices = (rows: OfficeRow[]): OfficeRow[] => rows.filter((r) => r.active);

/**
 * ¿La cuenta tiene jerarquía que mostrar? **Una sola oficina vigente no ve nada de árbol** (RULES C2): ni pestaña de
 * árbol, ni selectores, ni columnas.
 */
export function isMultiOffice(rows: OfficeRow[]): boolean {
  return activeOffices(rows).length > 1;
}

/** Aplana el árbol en orden de lectura (padre, luego hijas por nombre). */
export function flattenTree<T extends OfficeRow>(items: OfficeTreeItem<T>[]): T[] {
  const out: T[] = [];
  const walk = (xs: OfficeTreeItem<T>[]) => {
    for (const x of xs) {
      out.push(x.node);
      walk(x.children);
    }
  };
  walk(items);
  return out;
}

export interface OfficeOption {
  id: string;
  /** Ruta completa: `Central › Chuquisaca › Mesa Verde`. */
  name: string;
  depth: number;
}

/**
 * Las opciones de un selector de oficina: vigentes, en orden de árbol y con la RUTA COMPLETA como rótulo, para que dos
 * «Central» de ramas distintas no se confundan. Vacío si la cuenta no tiene más de una oficina (nada que elegir).
 */
export function officeOptions(rows: OfficeRow[]): OfficeOption[] {
  if (!isMultiOffice(rows)) return [];
  return flattenTree(buildOfficeTree(activeOffices(rows))).map((r) => ({ id: r.id, name: r.fullName || r.name, depth: r.depth }));
}

/** Normaliza para buscar: sin tildes ni mayúsculas. */
const norm = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function matchesOffice(row: OfficeRow, q: string): boolean {
  const needle = norm(q.trim());
  if (!needle) return true;
  return [row.name, row.code ?? '', row.city ?? '', row.typeName ?? '', row.fullName].some((v) => norm(v).includes(needle));
}

/**
 * El buscador del árbol: las que coinciden MÁS sus ancestros (para que se vea dónde están). `matched` son las que
 * coinciden de verdad; `visible`, esas más el camino hasta la raíz.
 */
export function filterOfficeTree(rows: OfficeRow[], q: string): { visible: Set<string>; matched: Set<string> } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const matched = new Set<string>();
  const visible = new Set<string>();
  if (!q.trim()) {
    rows.forEach((r) => visible.add(r.id));
    return { visible, matched };
  }
  for (const r of rows) {
    if (!matchesOffice(r, q)) continue;
    matched.add(r.id);
    let cur: OfficeRow | undefined = r;
    while (cur && !visible.has(cur.id)) {
      visible.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
  }
  return { visible, matched };
}

/** Los ids que arrancan expandidos para ver hasta `level` niveles (la raíz es el 0): se expanden los de profundidad < level. */
export function expandedUpTo(rows: OfficeRow[], level: number): Set<string> {
  return new Set(rows.filter((r) => r.depth < level).map((r) => r.id));
}

/** La profundidad máxima del árbol (para el control de nivel). */
export const maxDepthOf = (rows: OfficeRow[]): number => rows.reduce((m, r) => Math.max(m, r.depth), 0);

/** Los ids de un nodo y todos sus descendientes. */
export function branchIds(rows: OfficeRow[], id: string): string[] {
  return officeSubtree(rows, id).map((r) => r.id);
}

/** Cuántas hijas directas tiene. */
export const childCount = (rows: OfficeRow[], id: string): number => rows.filter((r) => r.parentId === id).length;

export type MoveVerdict = MoveCheck | 'NOT_FOUND';

/**
 * ¿Se puede soltar `nodeId` bajo `newParentId`? La regla es la de `checkOfficeMove` (la misma que aplica el servidor):
 * sin ciclos, la raíz no se mueve, profundidad máxima. El servidor decide igual; esto sólo evita el viaje inútil.
 */
export function moveVerdict(rows: OfficeRow[], nodeId: string, newParentId: string): MoveVerdict {
  const node = rows.find((r) => r.id === nodeId);
  const parent = rows.find((r) => r.id === newParentId);
  if (!node || !parent) return 'NOT_FOUND';
  const height = officeSubtree(rows, nodeId).reduce((m, r) => Math.max(m, r.depth - node.depth), 0);
  return checkOfficeMove(node, parent, height);
}

/** Por qué una baja se va a rechazar (el servidor la rechaza igual; la pantalla lo dice antes). Vacío = se puede intentar. */
export type DeactivateBlocker = 'ROOT' | 'ACTIVE_CHILDREN' | 'CREDITS' | 'MEMBERS';

export function deactivateBlockers(rows: OfficeRow[], id: string): { blockers: DeactivateBlocker[]; children: number; credits: number; members: number } {
  const row = rows.find((r) => r.id === id);
  if (!row) return { blockers: [], children: 0, credits: 0, members: 0 };
  const children = rows.filter((r) => r.parentId === id && r.active).length;
  const blockers: DeactivateBlocker[] = [];
  if (row.isRoot) blockers.push('ROOT');
  if (children > 0) blockers.push('ACTIVE_CHILDREN');
  if (row.credits > 0) blockers.push('CREDITS');
  if (row.members > 0) blockers.push('MEMBERS');
  return { blockers, children, credits: row.credits, members: row.members };
}

/**
 * ADR-0004: la cartera de la raíz se mueve. ¿Hay una raíz con créditos que ya tiene al menos una hija vigente? Entonces
 * hay que llevarla a «Mover cartera».
 */
export function rootPortfolioPending(rows: OfficeRow[]): OfficeRow | null {
  const root = rows.find((r) => r.isRoot && r.active);
  if (!root || root.credits <= 0) return null;
  return childCount(rows.filter((r) => r.active), root.id) > 0 ? root : null;
}

/**
 * La raíz con cartera que está por recibir su PRIMERA hija: crear la hija exige avisar antes.
 */
export function willBranchRootWithPortfolio(rows: OfficeRow[], parentId: string): boolean {
  const parent = rows.find((r) => r.id === parentId);
  return !!parent && parent.isRoot && parent.credits > 0 && childCount(rows.filter((r) => r.active), parent.id) === 0;
}

/**
 * ¿Puede esta cuenta crear su primera agencia desde el aviso de «una sola oficina»? Hace falta `office:write` y que el
 * plan deje otra oficina (el tope cuenta la raíz). `limit === null` = sin tope.
 */
export function canAddFirstOffice(opts: { canWrite: boolean; used: number; limit: number | null }): boolean {
  return opts.canWrite && (opts.limit === null || opts.used < opts.limit);
}

/** Las personas activas de una oficina, por nombre. */
export function officeMembers(members: Member[], officeId: string): Member[] {
  return members
    .filter((m) => m.isActive && m.branchId === officeId)
    .sort((a, b) => memberName(a).localeCompare(memberName(b)));
}

/** El rótulo de la oficina de una persona (ruta completa) o `null` si no tiene. */
export function officeLabelOf(rows: OfficeRow[], id: string | null | undefined): string | null {
  if (!id) return null;
  const r = rows.find((x) => x.id === id);
  return r ? r.fullName || r.name : null;
}

/** Un 409 de «una sola asignación por persona»: la pantalla lo explica en vez de ofrecer «agregar otra». */
export const SINGLE_ASSIGNMENT_STATUS = 409;

/**
 * Cuántas oficinas usa la cuenta y cuántas permite su plan (la raíz cuenta, ADR-0004). `usage.branches` lo manda la API;
 * si todavía no viene, se cuentan las vigentes de la lista. `limit: null` = sin tope.
 */
export function officePlan(
  account: { limits?: object; usage?: object } | null | undefined,
  rows: OfficeRow[],
): { used: number; limit: number | null } {
  return {
    used: (account?.usage as { branches?: number } | undefined)?.branches ?? activeOffices(rows).length,
    limit: (account?.limits as { branches?: number | null } | undefined)?.branches ?? null,
  };
}

/** Los errores del alta de crédito que se arreglan ELIGIENDO la oficina del crédito (F13). */
export const CREDIT_OFFICE_ERROR_CODES = ['CREDIT_BRANCH_UNRESOLVED', 'CREDIT_BRANCH_INVALID', 'CREDIT_OFFICE_OUT_OF_SCOPE'] as const;
export const isCreditOfficeError = (code?: string | null): boolean => !!code && (CREDIT_OFFICE_ERROR_CODES as readonly string[]).includes(code);

/**
 * La oficina con la que arranca el alta de un crédito: la de la persona si hay una sola oficina elegible y es la suya;
 * si no, ninguna (que elija). Con una sola oficina en la cuenta no hay selector y no se manda nada.
 */
export function defaultCreditOffice(options: { id: string }[], personBranchId: string | null | undefined): string {
  return personBranchId && options.some((o) => o.id === personBranchId) ? personBranchId : '';
}
