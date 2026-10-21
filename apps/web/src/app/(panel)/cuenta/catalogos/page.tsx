import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { EDITABLE_CATALOGS, isEditableCatalog, type CatalogRow } from '@/lib/catalog-editor';
import { CatalogEditor } from './catalog-editor';

/**
 * Los vocabularios del negocio. El catálogo abierto viaja en `?c=`; uno inventado cae al primero.
 * Pide `catalog:read`; la edición, `catalog:write` (la API valida los dos).
 */
export default async function CuentaCatalogosPage({ searchParams }: { searchParams: { c?: string } }) {
  const t = await getTranslations('account');
  const catalog = isEditableCatalog(searchParams.c) ? searchParams.c : EDITABLE_CATALOGS[0];

  // `includeInactive`: el editor tiene que ver también los desactivados para poder reactivarlos.
  const res = await apiCall<CatalogRow[]>(`/catalogs/${catalog}?includeInactive=true`, { method: 'GET', auth: true });

  // Un rol sin `catalog:read` no tiene la pestaña; si llegó por URL se le dice que no.
  if (res.status !== 200 || !res.body.data) {
    return <EmptyState title={t('noAccess')} text={res.body.error?.message} />;
  }
  // `key`: al cambiar de catálogo el editor arranca de cero, sin arrastrar el estado del anterior.
  return <CatalogEditor key={catalog} catalog={catalog} items={res.body.data} />;
}
