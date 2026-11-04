import { getTranslations } from 'next-intl/server';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { EDITABLE_CATALOGS, isEditableCatalog, type CatalogRow, type EditableCatalog } from '@/lib/catalog-editor';
import type { OfficeType } from '@/lib/offices';
import { CatalogEditor } from './catalog-editor';
import { OfficeTypesCard } from './office-types-card';

/**
 * Los vocabularios del negocio. Se piden **todos** los catálogos de una vez: la pantalla muestra cuántas opciones tiene
 * cada uno y cambia de catálogo sin volver al servidor. El abierto viaja en `?c=`; uno inventado cae al primero.
 * Pide `catalog:read`; la edición, `catalog:write` (la API valida los dos).
 */
export default async function CuentaCatalogosPage({ searchParams }: { searchParams: { c?: string } }) {
  const t = await getTranslations('account');
  const catalog = isEditableCatalog(searchParams.c) ? searchParams.c : EDITABLE_CATALOGS[0];

  // `includeInactive`: el editor tiene que ver también los desactivados para poder reactivarlos.
  const [results, officeTypes] = await Promise.all([
    Promise.all(EDITABLE_CATALOGS.map((c) => apiCall<CatalogRow[]>(`/catalogs/${c}?includeInactive=true`, { method: 'GET', auth: true }))),
    // Los tipos de oficina se piden con `office:read`; sin él, simplemente no se muestra la tarjeta.
    apiCall<OfficeType[]>('/branch-types', { method: 'GET', auth: true }),
  ]);

  // Un rol sin `catalog:read` no tiene la pestaña; si llegó por URL se le dice que no.
  const failed = results.find((r) => r.status !== 200 || !r.body.data);
  if (failed) return <EmptyState title={t('noAccess')} text={failed.body.error?.message} />;

  const lists = Object.fromEntries(EDITABLE_CATALOGS.map((c, i) => [c, results[i]!.body.data!])) as Record<EditableCatalog, CatalogRow[]>;
  return (
    <div className="space-y-6">
      <CatalogEditor catalog={catalog} lists={lists} />
      {officeTypes.status === 200 && officeTypes.body.data && <OfficeTypesCard types={officeTypes.body.data} />}
    </div>
  );
}
