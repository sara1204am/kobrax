/** Catálogos configurables por tenant (medios de pago, bancos, …). Thin sobre `apiQuery`. */
import type { CatalogType } from '@kobrax/shared';
import { apiQuery, type QueryResult } from './api-client';

export interface CatalogOption {
  id: string;
  catalog: CatalogType;
  code: string;
  label: string;
  sortOrder: number;
  /** `requiresBank` (PAYMENT_METHOD) · `body` (WHATSAPP_TEMPLATE, con {{cliente}}/{{saldo}}). */
  metadata: { requiresBank?: boolean; body?: string } | null;
}

/** Ítems activos del catálogo, ya ordenados por el server. */
export function listCatalog(catalog: CatalogType): Promise<QueryResult<CatalogOption[]>> {
  return apiQuery<CatalogOption[]>(`/catalogs/${catalog}`);
}

/**
 * Igual que `listCatalog`, pero cachea el resultado en memoria por tipo: los catálogos casi no cambian
 * y se abren repetidas veces (el sheet de registrar en cada gestión). Evita el round-trip —y el parpadeo
 * bajo señal débil— en reaperturas. // ponytail: cache de proceso; se limpia al reabrir la app.
 */
const catalogCache = new Map<CatalogType, CatalogOption[]>();
export async function listCatalogCached(catalog: CatalogType): Promise<QueryResult<CatalogOption[]>> {
  const hit = catalogCache.get(catalog);
  if (hit) return { status: 'ok', data: hit, total: hit.length };
  const res = await listCatalog(catalog);
  if (res.status === 'ok') catalogCache.set(catalog, res.data);
  return res;
}
