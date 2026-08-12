import { getTranslations } from 'next-intl/server';
import type { ConfigScreen } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { ColumnMapper } from './column-mapper';

/** Emparejar las columnas del archivo con los datos de la cartera, contra un archivo de muestra. */
export default async function ImportColumnsPage() {
  const t = await getTranslations('panel.import');
  const { status, body } = await apiCall<ConfigScreen>('/imports/portfolio/config', {
    method: 'GET',
    auth: true,
  });

  if (status !== 200 || !body.data) {
    return <EmptyState title={t('columns.title')} text={body.error?.message} />;
  }

  return (
    <>
      <PageHeader title={t('columns.title')} subtitle={t('columns.subtitle')} />
      <ColumnMapper screen={body.data} />
    </>
  );
}
