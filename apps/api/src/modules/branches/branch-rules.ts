/**
 * Reglas puras de las oficinas (sin base de datos: se prueban solas).
 */

export type DeactivationBlock = 'ROOT' | 'CHILDREN' | 'CREDITS' | 'MEMBERS' | null;

/**
 * ¿Qué impide dar de baja (desactivar o borrar) una oficina? El orden es el que se le dice a la persona: primero lo
 * que no tiene arreglo (la raíz), después lo que se resuelve de arriba hacia abajo (hijas), luego la cartera y la gente.
 */
export function deactivationBlock(x: { isRoot: boolean; children: number; credits: number; members: number }): DeactivationBlock {
  if (x.isRoot) return 'ROOT';
  if (x.children > 0) return 'CHILDREN';
  if (x.credits > 0) return 'CREDITS';
  if (x.members > 0) return 'MEMBERS';
  return null;
}
