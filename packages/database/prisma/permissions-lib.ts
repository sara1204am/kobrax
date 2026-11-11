/**
 * Lógica pura de la herramienta de permisos efectivos (`permissions-snapshot.ts`, F14 · F9): comparar dos volcados y comprobar que las copias de roles
 * por cuenta dicen lo mismo que el rol global de origen. Sin base de datos, para poder probarla.
 *
 * El volcado NO lleva datos personales: solo identificadores y códigos de permiso.
 */

export type PermissionSource = 'account' | 'global';

export interface MembershipPermissions {
  accountId: string;
  userId: string;
  /** Nombre del rol global de la membresía (`COLLECTOR`…). */
  role: string;
  /** De dónde salen hoy sus permisos: la copia de su cuenta (F5) o, si la cuenta no la tiene, el rol global. */
  source: PermissionSource;
  permissions: string[];
}

export interface PermissionsSnapshot {
  takenAt: string;
  memberships: MembershipPermissions[];
}

const keyOf = (m: Pick<MembershipPermissions, 'accountId' | 'userId'>) => `${m.accountId}:${m.userId}`;

export interface MembershipChange {
  accountId: string;
  userId: string;
  added: string[];
  removed: string[];
}

export interface SnapshotDiff {
  changed: MembershipChange[];
  /** Membresías que estaban y ya no. */
  gone: string[];
  /** Membresías nuevas. */
  appeared: string[];
}

/** Lo que una persona gana y pierde de un volcado a otro, sobre lo que PUEDE hacer (alcances normalizados). Única fuente para `diffSnapshots` y `summarizeByRole`. */
function deltaOf(mb: MembershipPermissions, ma: MembershipPermissions): { added: string[]; removed: string[] } {
  const sb = new Set(normalizeScopes(mb.permissions));
  const sa = new Set(normalizeScopes(ma.permissions));
  return { added: [...sa].filter((p) => !sb.has(p)).sort(), removed: [...sb].filter((p) => !sa.has(p)).sort() };
}

export function diffSnapshots(before: PermissionsSnapshot, after: PermissionsSnapshot): SnapshotDiff {
  const b = new Map(before.memberships.map((m) => [keyOf(m), m]));
  const a = new Map(after.memberships.map((m) => [keyOf(m), m]));
  const changed: MembershipChange[] = [];
  for (const [key, mb] of b) {
    const ma = a.get(key);
    if (!ma) continue;
    const { added, removed } = deltaOf(mb, ma);
    if (added.length || removed.length) changed.push({ accountId: ma.accountId, userId: ma.userId, added, removed });
  }
  return {
    changed,
    gone: [...b.keys()].filter((k) => !a.has(k)).sort(),
    appeared: [...a.keys()].filter((k) => !b.has(k)).sort(),
  };
}

export interface DiffPolicy {
  /** Permisos cuya APARICIÓN es planificada (p. ej. los que agrega la versión que se despliega). */
  allowAdded?: readonly string[];
  /** Toda APARICIÓN de permisos es planificada (un despliegue que agrega permisos a los roles): solo importan lo que se quita y las membresías que cambian. */
  allowAnyAdded?: boolean;
  /** Permisos cuya DESAPARICIÓN es planificada. */
  allowRemoved?: readonly string[];
  /** ¿Se admiten membresías nuevas / que desaparecen (altas y bajas entre un volcado y otro)? */
  allowMembershipChanges?: boolean;
}

export interface UnplannedChanges {
  unplanned: MembershipChange[];
  membershipChanges: { gone: string[]; appeared: string[] };
}

/** Lo que NO estaba planificado: cero diferencias salvo las permitidas. */
export function unplanned(diff: SnapshotDiff, policy: DiffPolicy = {}): UnplannedChanges {
  const addOk = new Set(policy.allowAdded ?? []);
  const remOk = new Set(policy.allowRemoved ?? []);
  const bad: MembershipChange[] = [];
  for (const c of diff.changed) {
    const added = policy.allowAnyAdded ? [] : c.added.filter((p) => !addOk.has(p));
    const removed = c.removed.filter((p) => !remOk.has(p));
    if (added.length || removed.length) bad.push({ ...c, added, removed });
  }
  const m = policy.allowMembershipChanges ? { gone: [], appeared: [] } : { gone: diff.gone, appeared: diff.appeared };
  return { unplanned: bad, membershipChanges: m };
}

export const hasUnplanned = (u: UnplannedChanges): boolean => u.unplanned.length > 0 || u.membershipChanges.gone.length > 0 || u.membershipChanges.appeared.length > 0;

/**
 * Los permisos de ALCANCE de datos no suman: con `data:scope:all` los más angostos no agregan nada (el sistema toma el total). F5 dejó a lo sumo UNO por rol;
 * el rol global del administrador, en cambio, los traía los tres. Para comparar lo que cada persona PUEDE hacer se normaliza: con `all`, los demás se descartan.
 */
export function normalizeScopes(permissions: readonly string[]): string[] {
  const hasAll = permissions.includes('data:scope:all');
  return permissions.filter((p) => !(hasAll && (p === 'data:scope:subtree' || p === 'data:scope:branch')));
}

export interface RoleChangeGroup {
  role: string;
  people: number;
  added: string[];
  removed: string[];
}

/**
 * Resume el cambio POR ROL: en un despliegue todas las personas de un rol cambian igual, así que «COLLECTOR (26 personas): +x −y» se lee de un vistazo
 * y una persona que se aparta del grupo salta a la vista (queda en su propio grupo).
 */
export function summarizeByRole(before: PermissionsSnapshot, after: PermissionsSnapshot): RoleChangeGroup[] {
  const a = new Map(after.memberships.map((m) => [keyOf(m), m]));
  const groups = new Map<string, RoleChangeGroup>();
  for (const mb of before.memberships) {
    const ma = a.get(keyOf(mb));
    if (!ma) continue;
    const { added, removed } = deltaOf(mb, ma);
    if (!added.length && !removed.length) continue;
    const key = `${mb.role}|${added.join(',')}|${removed.join(',')}`;
    const g = groups.get(key) ?? { role: mb.role, people: 0, added, removed };
    g.people += 1;
    groups.set(key, g);
  }
  return [...groups.values()].sort((x, y) => x.role.localeCompare(y.role) || y.people - x.people);
}

/** Lo que `check` necesita de cada membresía para comparar el rol global con su copia por cuenta. */
export interface SourceCompareRow {
  accountId: string;
  userId: string;
  role: string;
  /** `null` = la cuenta no tiene copia de ese rol. */
  accountPermissions: string[] | null;
  globalPermissions: string[];
  /** La copia ya se editó o la tocó un *rollout* (`diverged_at`): una diferencia es esperable. */
  diverged: boolean;
}

export interface SourceMismatch {
  accountId: string;
  userId: string;
  role: string;
  /** Tiene la copia de la cuenta y el rol global no. */
  onlyAccount: string[];
  /** Tiene el rol global y la copia de la cuenta no. */
  onlyGlobal: string[];
  diverged: boolean;
  /** La cuenta no tiene copia del rol (no debería pasar tras F5). */
  noCopy: boolean;
}

/**
 * Compara, por membresía, los permisos del rol global con los de la copia de su cuenta. Las diferencias de una copia que ya divergió son
 * esperables; las demás (y una cuenta sin copia) son el problema que esta comprobación busca.
 */
export function compareSources(rows: readonly SourceCompareRow[]): SourceMismatch[] {
  const out: SourceMismatch[] = [];
  for (const r of rows) {
    if (r.accountPermissions === null) {
      out.push({ accountId: r.accountId, userId: r.userId, role: r.role, onlyAccount: [], onlyGlobal: [...r.globalPermissions].sort(), diverged: r.diverged, noCopy: true });
      continue;
    }
    const g = new Set(normalizeScopes(r.globalPermissions));
    const a = new Set(normalizeScopes(r.accountPermissions));
    const onlyAccount = [...a].filter((p) => !g.has(p)).sort();
    const onlyGlobal = [...g].filter((p) => !a.has(p)).sort();
    if (onlyAccount.length || onlyGlobal.length) out.push({ accountId: r.accountId, userId: r.userId, role: r.role, onlyAccount, onlyGlobal, diverged: r.diverged, noCopy: false });
  }
  return out;
}

/** Las diferencias que NO se explican por una copia divergida. */
export const unexpectedMismatches = (m: readonly SourceMismatch[]): SourceMismatch[] => m.filter((x) => x.noCopy || !x.diverged);
