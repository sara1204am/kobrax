/**
 * Qué tabs del shell de campo se ofrecen según los permisos (F14 · F8, D-9 / N-07).
 *
 * 🔴 Solo decide qué se ofrece: la API autoriza cada llamada. Sin permisos conocidos todavía (`null`: no se leyó `me`) se ofrecen todos.
 */
export type TabName = 'index' | 'agenda' | 'rutas' | 'cobranza' | 'mas';

/** El permiso que pide cada tab (`null` = lo ve cualquiera con sesión). */
export const TAB_PERMISSION: Record<TabName, string | null> = {
  index: null,
  agenda: 'agenda:read',
  rutas: 'route:read',
  cobranza: 'collection:read',
  mas: null,
};

export function tabAllowed(name: TabName, permissions: readonly string[] | null | undefined): boolean {
  const need = TAB_PERMISSION[name];
  if (need === null || !permissions) return true;
  return permissions.includes(need);
}
