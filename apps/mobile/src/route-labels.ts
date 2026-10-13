/**
 * Cómo se nombra un punto de la ruta: «Casa», «Casa de Luis Vargas (garante)». Una sola copia para el mapa, la lista, la
 * confirmación y el resultado (antes vivía dentro de `crear.tsx`).
 */
const TIPO_LUGAR: Record<string, string> = {
  HOME: 'Casa',
  WORK: 'Trabajo',
  GUARANTOR: 'Garante',
  FAMILY: 'Familia',
  OTHER: 'Otra ubicación',
};

export interface PlaceLike {
  locationType?: string | null;
  ownerName?: string | null;
  ownerRelation?: string | null;
}

/** «Casa» · «Casa de Luis Vargas (garante)» — de quién es el punto. Sin tipo conocido: «Ubicación». */
export function lugarLabel(loc: PlaceLike): string {
  const tipo = (loc.locationType && TIPO_LUGAR[loc.locationType]) || 'Ubicación';
  if (!loc.ownerName) return tipo;
  const rel = loc.ownerRelation ? TIPO_LUGAR[loc.ownerRelation]?.toLowerCase() : undefined;
  return `${tipo} de ${loc.ownerName}${rel ? ` (${rel})` : ''}`;
}
