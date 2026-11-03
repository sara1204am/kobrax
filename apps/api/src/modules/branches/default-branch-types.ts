/**
 * Los tipos de oficina con que nace toda cuenta (F13 · R1). Son el punto de partida: se renombran, se agregan otros y se
 * desactivan desde `/branch-types`. Mismo catálogo que la migración `20261102000000_oficinas_arbol` y el seed.
 */
export const DEFAULT_BRANCH_TYPES: readonly { code: string; name: string; sortOrder: number }[] = [
  { code: 'CENTRAL', name: 'Central', sortOrder: 0 },
  { code: 'REGIONAL', name: 'Regional', sortOrder: 1 },
  { code: 'AGENCIA', name: 'Agencia', sortOrder: 2 },
];

/** El tipo de la oficina raíz de una cuenta nueva. */
export const ROOT_BRANCH_TYPE_CODE = 'CENTRAL';
