import { DATA_SCOPE_PERMISSIONS, withDependencies, type PermissionCatalogEntry, type PermissionRisk } from '@kobrax/shared';

/**
 * Lógica pura del editor de roles (F14 · F7). La validación de verdad vive en `@kobrax/shared` (`checkRoleEdit`) y la hace cumplir el servidor;
 * esto sólo ayuda a armar la pantalla: agrupar, marcar dependencias y resumir qué cambió.
 */

/** Orden de los módulos en el editor (lo más usado arriba). Los que no estén van al final, por nombre. */
export const MODULE_ORDER = ['client', 'credit', 'assignment', 'collection', 'payment', 'route', 'agenda', 'report', 'catalog', 'office', 'user', 'role', 'account', 'audit', 'support'];

/** La clave de i18n de un permiso: los `:` no sirven de separador en los diccionarios. */
export const permissionKey = (code: string): string => code.replace(/:/g, '_');

export const isScopePermission = (code: string): boolean => DATA_SCOPE_PERMISSIONS.includes(code);

export interface ModuleGroup {
  module: string;
  items: PermissionCatalogEntry[];
}

/** Los permisos agrupados por módulo, SIN los de alcance de datos (esos van en el selector de alcance). */
export function groupByModule(catalog: readonly PermissionCatalogEntry[]): ModuleGroup[] {
  const groups = new Map<string, PermissionCatalogEntry[]>();
  for (const p of catalog) {
    if (isScopePermission(p.code)) continue;
    const list = groups.get(p.module) ?? [];
    list.push(p);
    groups.set(p.module, list);
  }
  const rank = (m: string) => {
    const i = MODULE_ORDER.indexOf(m);
    return i === -1 ? MODULE_ORDER.length : i;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([module, items]) => ({ module, items: [...items].sort((x, y) => x.code.localeCompare(y.code)) }));
}

/** Los permisos concedidos que dependen (directa o indirectamente) de `code`. */
export function dependentsOf(code: string, granted: readonly string[], catalog: readonly Pick<PermissionCatalogEntry, 'code' | 'requires'>[]): string[] {
  const byCode = new Map(catalog.map((c) => [c.code, c]));
  const out = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of granted) {
      if (out.has(g) || g === code) continue;
      const reqs = byCode.get(g)?.requires ?? [];
      if (reqs.includes(code) || reqs.some((r) => out.has(r))) {
        out.add(g);
        grew = true;
      }
    }
  }
  return [...out];
}

export interface ToggleResult {
  next: string[];
  /** Dependencias que se marcaron solas al encender. */
  autoAdded: string[];
  /** Permisos que dependían de éste y se apagaron solos al apagar. */
  autoRemoved: string[];
}

/**
 * Enciende o apaga un permiso cuidando las dependencias: encender marca también lo que necesita; apagar apaga lo que dependía de él.
 * El resultado le dice a la pantalla qué se tocó de más para avisarlo (nada cambia en silencio).
 */
export function togglePermission(desired: readonly string[], code: string, on: boolean, catalog: readonly PermissionCatalogEntry[]): ToggleResult {
  const current = new Set(desired);
  if (on) {
    const closed = new Set(withDependencies([...current, code], catalog));
    const autoAdded = [...closed].filter((c) => !current.has(c) && c !== code);
    return { next: [...closed].sort(), autoAdded: autoAdded.sort(), autoRemoved: [] };
  }
  const autoRemoved = dependentsOf(code, [...current], catalog);
  const gone = new Set([code, ...autoRemoved]);
  return { next: [...current].filter((c) => !gone.has(c)).sort(), autoAdded: [], autoRemoved: autoRemoved.sort() };
}

/** El permiso de alcance de datos que tiene el conjunto (`null` = alcance propio). */
export function scopeOf(desired: readonly string[]): string | null {
  return desired.find(isScopePermission) ?? null;
}

/** Cambia el alcance de datos: quita el que hubiera y pone el pedido (`null` = propio). */
export function setScope(desired: readonly string[], scope: string | null): string[] {
  const rest = desired.filter((c) => !isScopePermission(c));
  return (scope ? [...rest, scope] : rest).sort();
}

export const isHighRisk = (risk: PermissionRisk): boolean => risk === 'HIGH' || risk === 'CRITICAL';

export interface ChangeSummary {
  added: string[];
  removed: string[];
  /** Lo AÑADIDO de riesgo alto o crítico: el modal de confirmación lo destaca. */
  highRiskAdded: string[];
  count: number;
}

export function summarizeChange(current: readonly string[], desired: readonly string[], catalog: readonly PermissionCatalogEntry[]): ChangeSummary {
  const cur = new Set(current);
  const des = new Set(desired);
  const added = [...des].filter((c) => !cur.has(c)).sort();
  const removed = [...cur].filter((c) => !des.has(c)).sort();
  const risk = new Map(catalog.map((c) => [c.code, c.risk]));
  return { added, removed, highRiskAdded: added.filter((c) => isHighRisk(risk.get(c) ?? 'LOW')), count: added.length + removed.length };
}
