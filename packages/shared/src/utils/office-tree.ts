/**
 * Árbol de oficinas (F13 · ADR-0003). Lógica PURA que comparten la API, la web y el móvil (RULES B10): la ruta
 * materializada, la validación de mover un nodo, el subárbol y la ruta completa legible (R10).
 *
 * La **ruta** (`path`) de un nodo es la de su padre más su id, separadas y rodeadas por `/`: `/raíz/regional/agencia/`.
 * Así el subárbol de un nodo es "todo lo que empieza con su ruta" (`LIKE '<ruta>%'`, índice `text_pattern_ops`) y no hace
 * falta una consulta recursiva.
 */

/** Guarda técnica de profundidad (no un tope de negocio): acota las consultas y evita árboles degenerados. */
export const MAX_OFFICE_DEPTH = 8;

/** Separador de la ruta completa que ve la persona: `Central › Chuquisaca › Mesa Verde`. */
export const OFFICE_PATH_SEPARATOR = ' › ';

export interface OfficeNodeLike {
  id: string;
  name: string;
  parentId: string | null;
  path: string;
  depth: number;
}

/** La ruta de un hijo. Sin padre es una raíz. */
export function officePath(parentPath: string | null, id: string): string {
  return `${parentPath ?? '/'}${id}/`;
}

/** Los ids de una ruta, de la raíz al nodo. */
export function officePathIds(path: string): string[] {
  return path.split('/').filter(Boolean);
}

/** Profundidad de una ruta: la raíz es 0. */
export function officeDepth(path: string): number {
  return Math.max(0, officePathIds(path).length - 1);
}

/** ¿`path` es el nodo `ancestorPath` o está dentro de su subárbol? */
export function isInOfficeSubtree(path: string, ancestorPath: string): boolean {
  return path.startsWith(ancestorPath);
}

export type MoveCheck = 'OK' | 'SAME_PARENT' | 'INTO_ITSELF' | 'INTO_OWN_SUBTREE' | 'IS_ROOT' | 'TOO_DEEP';

/**
 * ¿Se puede mover `node` bajo `newParent`? Sin ciclos (no puede entrar en su propio subárbol), la raíz no se mueve y el
 * subárbol movido no puede pasar la profundidad máxima.
 */
export function checkOfficeMove(
  node: { id: string; path: string; parentId: string | null; isRoot?: boolean },
  newParent: { id: string; path: string; depth: number },
  subtreeHeight = 0,
  maxDepth = MAX_OFFICE_DEPTH,
): MoveCheck {
  if (node.isRoot || node.parentId === null) return 'IS_ROOT';
  if (node.id === newParent.id) return 'INTO_ITSELF';
  if (isInOfficeSubtree(newParent.path, node.path)) return 'INTO_OWN_SUBTREE';
  if (node.parentId === newParent.id) return 'SAME_PARENT';
  if (newParent.depth + 1 + subtreeHeight > maxDepth) return 'TOO_DEEP';
  return 'OK';
}

/** La ruta de un nodo del subárbol movido: cambia el prefijo viejo por el nuevo. */
export function rebaseOfficePath(path: string, fromPrefix: string, toPrefix: string): string {
  if (!path.startsWith(fromPrefix)) throw new Error('La ruta no pertenece al subárbol que se mueve');
  return toPrefix + path.slice(fromPrefix.length);
}

/**
 * Quita las rutas que ya están cubiertas por otra más alta. Una persona asignada a la regional y a una de sus agencias
 * ve lo mismo que con la regional sola: el alcance es la unión de subárboles y no necesita repetir.
 */
export function collapseOfficePaths(paths: string[]): string[] {
  const sorted = [...new Set(paths)].sort((a, b) => a.length - b.length);
  const kept: string[] = [];
  for (const p of sorted) if (!kept.some((k) => isInOfficeSubtree(p, k))) kept.push(p);
  return kept;
}

/** El alcance de una persona: ¿el nodo `path` queda dentro de alguna de sus rutas asignadas? */
export function officeInScope(path: string, scopePaths: string[]): boolean {
  return scopePaths.some((s) => isInOfficeSubtree(path, s));
}

/** Los nodos del subárbol de `rootId` (él incluido), a partir de una lista plana. */
export function officeSubtree<T extends OfficeNodeLike>(nodes: T[], rootId: string): T[] {
  const root = nodes.find((n) => n.id === rootId);
  if (!root) return [];
  return nodes.filter((n) => isInOfficeSubtree(n.path, root.path));
}

export interface OfficeTreeItem<T extends OfficeNodeLike> {
  node: T;
  children: OfficeTreeItem<T>[];
}

/** De lista plana a árbol, ordenado por nombre dentro de cada nivel. Un nodo cuyo padre no está en la lista es una raíz. */
export function buildOfficeTree<T extends OfficeNodeLike>(nodes: T[]): OfficeTreeItem<T>[] {
  const byId = new Map(nodes.map((n) => [n.id, { node: n, children: [] as OfficeTreeItem<T>[] }]));
  const roots: OfficeTreeItem<T>[] = [];
  for (const item of byId.values()) {
    const parent = item.node.parentId ? byId.get(item.node.parentId) : undefined;
    (parent ? parent.children : roots).push(item);
  }
  const sort = (xs: OfficeTreeItem<T>[]) => {
    xs.sort((a, b) => a.node.name.localeCompare(b.node.name, 'es'));
    xs.forEach((x) => sort(x.children));
  };
  sort(roots);
  return roots;
}

/**
 * La ruta completa legible (R10): `Central › Chuquisaca › Central`. Distingue dos oficinas con el mismo nombre en ramas
 * distintas. Si falta un ancestro en la lista, se omite (no se inventa).
 */
export function officeFullName(
  nodes: Pick<OfficeNodeLike, 'id' | 'name' | 'path'>[],
  id: string,
  separator = OFFICE_PATH_SEPARATOR,
): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  if (!node) return '';
  return officePathIds(node.path)
    .map((pid) => byId.get(pid)?.name)
    .filter((n): n is string => !!n)
    .join(separator);
}

/**
 * Nombre CORTO para listas y selectores (R10): la ruta sin la raíz —la raíz es la propia empresa y repetirla en cada
 * fila es ruido—, salvo que el nodo sea la raíz. `Chuquisaca › Central` distingue la agencia Central de la raíz `Central`;
 * en una cuenta plana (raíz + agencias) queda el nombre de la agencia, como antes.
 */
export function officeLabel(nodes: Pick<OfficeNodeLike, 'id' | 'name' | 'path'>[], id: string): string {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const node = byId.get(id);
  if (!node) return '';
  const ids = officePathIds(node.path);
  const shown = ids.length > 1 ? ids.slice(1) : ids;
  return shown
    .map((pid) => byId.get(pid)?.name)
    .filter((n): n is string => !!n)
    .join(OFFICE_PATH_SEPARATOR);
}
