/**
 * Los catálogos que el administrador puede editar desde Cuenta.
 *
 * Son los vocabularios del negocio: cómo se llaman los medios de pago, los bancos, los motivos de no pago, los rubros.
 * Quedan fuera, a propósito:
 *  - `WHATSAPP_TEMPLATE`: tiene su propia pestaña (Mensajes).
 *  - `INCOME_SOURCE`, `PRIORITY`, `EXPECTED_RESULT`, `CURRENCY`: sus códigos los usa la lógica del producto (motivos que
 *    se ofrecen según la fuente de ingreso, orden de la agenda, monedas del país). Agregar uno nuevo no cambiaría nada
 *    y renombrarlo en silencio confunde.
 *  - `CAMPAIGN`: nada lo consume todavía.
 *
 * El orden es el del selector.
 */
export const EDITABLE_CATALOGS = [
  'PAYMENT_METHOD',
  'BANK',
  'NO_PAYMENT_REASON',
  'OCCUPATION',
  'CREDIT_TYPE',
  'COLLATERAL_TYPE',
  'COLLECTION_MODALITY',
  'CANCEL_REASON',
  'RESCHEDULE_REASON',
  'SPECIAL_CATEGORY',
  'ADDRESS_TYPE',
  'PHONE_TYPE',
  'REMINDER_CATEGORY',
] as const;

export type EditableCatalog = (typeof EDITABLE_CATALOGS)[number];

export function isEditableCatalog(value: string | undefined): value is EditableCatalog {
  return (EDITABLE_CATALOGS as readonly string[]).includes(value ?? '');
}

/** Un ítem tal como lo devuelve `GET /catalogs/:catalog?includeInactive=true`. */
export interface CatalogRow {
  id: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

const CODE_MAX = 40;

/**
 * El código interno de un ítem nuevo, sacado de su nombre: «Pago móvil» → `PAGO_MOVIL`.
 *
 * El código no se muestra ni se edita después: sólo tiene que ser estable y único dentro del catálogo. Si ya existe
 * (otro ítem con el mismo nombre, o uno desactivado), se le suma `_2`, `_3`… en vez de dar error.
 */
export function codeFromLabel(label: string, taken: readonly string[]): string {
  const base =
    label
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, CODE_MAX - 4) || 'ITEM';
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/**
 * Mueve un ítem una posición y devuelve **sólo** los que cambian de `sortOrder`.
 *
 * El orden resultante es 1, 2, 3… por posición: los ítems que venían todos con el mismo número (o con huecos) se
 * normalizan de paso, y con eso intercambiar dos vecinos siempre produce un cambio visible. `[]` si no se puede
 * mover (ya está en el borde).
 */
export function reorderPatches(
  items: readonly Pick<CatalogRow, 'id' | 'sortOrder'>[],
  index: number,
  direction: -1 | 1,
): { id: string; sortOrder: number }[] {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [];
  const next = [...items];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next.flatMap((item, i) => (item.sortOrder === i + 1 ? [] : [{ id: item.id, sortOrder: i + 1 }]));
}
