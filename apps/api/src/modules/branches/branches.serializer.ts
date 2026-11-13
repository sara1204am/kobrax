import type { Branch, BranchType } from '@prisma/client';
import { officeFullName } from '@kobrax/shared';

export interface BranchStats {
  /** Personas con asignación vigente a ESTA oficina (no a su subárbol). */
  members: number;
  /** Créditos vivos de ESTA oficina. */
  credits: number;
  /** Oficinas hijas vivas (directas). */
  children: number;
  managerName: string | null;
}

export type BranchWithType = Branch & { type: Pick<BranchType, 'id' | 'code' | 'name'> };

/**
 * Una oficina con lo que la pantalla necesita para decidir. `fullName` es la ruta completa legible
 * («Central › Chuquisaca › Mesa Verde»): R10, dos oficinas se pueden llamar igual en ramas distintas.
 * `nodes` son las oficinas que dan los nombres de la ruta (el árbol entero o sus ancestros).
 */
export function serializeBranch(b: BranchWithType, stats: BranchStats, nodes: Pick<Branch, 'id' | 'name' | 'path'>[]) {
  return {
    id: b.id,
    name: b.name,
    code: b.code,
    city: b.city,
    address: b.address,
    latitude: b.latitude === null ? null : Number(b.latitude),
    longitude: b.longitude === null ? null : Number(b.longitude),
    managerUserId: b.managerUserId,
    managerName: stats.managerName,
    active: b.active,
    parentId: b.parentId,
    typeId: b.typeId,
    typeCode: b.type.code,
    typeName: b.type.name,
    path: b.path,
    depth: b.depth,
    isRoot: b.isRoot,
    fullName: officeFullName(nodes, b.id),
    members: stats.members,
    credits: stats.credits,
    children: stats.children,
  };
}

export function serializeBranchType(t: BranchType) {
  return { id: t.id, code: t.code, name: t.name, sortOrder: t.sortOrder, isActive: t.isActive };
}
