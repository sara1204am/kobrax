/** Catálogos configurables por tenant (medios de pago, bancos, …). Thin sobre `apiQuery`. */
import type { CatalogType } from '@kobrax/shared';
import { apiQuery, type QueryResult } from './api-client';

export interface CatalogOption {
  id: string;
  catalog: CatalogType;
  code: string;
  label: string;
  sortOrder: number;
  /** `requiresBank` en PAYMENT_METHOD: el formulario de promesa pide banco si está en true. */
  metadata: { requiresBank?: boolean } | null;
}

/** Ítems activos del catálogo, ya ordenados por el server. */
export function listCatalog(catalog: CatalogType): Promise<QueryResult<CatalogOption[]>> {
  return apiQuery<CatalogOption[]>(`/catalogs/${catalog}`);
}
