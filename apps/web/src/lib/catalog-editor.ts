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
 *  - `ADDRESS_TYPE`, `PHONE_TYPE`, `REMINDER_CATEGORY`: ninguna pantalla (web, móvil ni API) los lee; editarlos no cambiaría
 *    nada. Siguen sembrados, pero no se ofrecen hasta que alguna pantalla los use.
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
  /** Contenido adicional del ítem (descripción; en los medios de pago, `ledgerMethod`). Opcional: no todos los consumidores lo piden. */
  metadata?: Record<string, unknown> | null;
}

export const CODE_MAX = 40;
export const CATALOG_NAME_MAX = 120;
export const CATALOG_DESCRIPTION_MAX = 200;
/** Lo que produce `codeFromLabel`: mayúsculas, dígitos y guiones bajos, sin espacios. */
export const CODE_PATTERN = /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/;

export type CodeProblem = 'format' | 'duplicate';

/** La descripción de un ítem, guardada en su `metadata` (la API ya la acepta y la devuelve). */
export function descriptionOf(row: Pick<CatalogRow, 'metadata'>): string {
  const d = row.metadata?.description;
  return typeof d === 'string' ? d : '';
}

/** Por qué un código escrito a mano no sirve (`null` si sirve). La API sólo vuelve a comprobar que no esté repetido. */
export function codeProblem(code: string, taken: readonly string[]): CodeProblem | null {
  if (code.length > CODE_MAX || !CODE_PATTERN.test(code)) return 'format';
  return taken.includes(code) ? 'duplicate' : null;
}

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
 * Mueve el ítem de la posición `from` a la posición `to` y devuelve **sólo** los que cambian de `sortOrder`.
 *
 * El orden resultante es 1, 2, 3… por posición: los ítems que venían todos con el mismo número (o con huecos) se
 * normalizan de paso, y con eso mover siempre produce un cambio visible. `[]` si no hay nada que mover (mismo lugar o
 * fuera de la lista).
 */
export function movePatches(
  items: readonly Pick<CatalogRow, 'id' | 'sortOrder'>[],
  from: number,
  to: number,
): { id: string; sortOrder: number }[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return [];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next.flatMap((item, i) => (item.sortOrder === i + 1 ? [] : [{ id: item.id, sortOrder: i + 1 }]));
}

/** Mueve un ítem una posición hacia arriba (`-1`) o hacia abajo (`1`). */
export function reorderPatches(
  items: readonly Pick<CatalogRow, 'id' | 'sortOrder'>[],
  index: number,
  direction: -1 | 1,
): { id: string; sortOrder: number }[] {
  return movePatches(items, index, index + direction);
}
