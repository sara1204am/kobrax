import type { CatalogItem } from '@prisma/client';

/** Payload público de un ítem de catálogo (lo que consume el móvil para los dropdowns). */
export function serializeCatalogItem(c: CatalogItem) {
  return {
    id: c.id,
    catalog: c.catalog,
    code: c.code,
    label: c.label,
    sortOrder: c.sortOrder,
    metadata: c.metadata,
  };
}
