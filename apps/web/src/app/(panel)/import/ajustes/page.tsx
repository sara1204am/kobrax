import { getTranslations } from 'next-intl/server';
import type { ConfigScreen } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { SettingsForm } from './settings-form';

/**
 * Ajustes del import: cómo se lee el archivo que emite el sistema del cliente.
 *
 * Una sola llamada trae la config, el catálogo de campos, la última corrida y los candidatos de
 * alcance — la pantalla no sirve de nada con la config sin lo demás.
 */
export default async function ImportSettingsPage() {
  const t = await getTranslations('panel.import');
  const { status, body } = await apiCall<ConfigScreen>('/imports/portfolio/config', {
    method: 'GET',
    auth: true,
  });

  // 403 = el rol no tiene `client:import`. El ítem del menú tampoco se le dibuja, así que llegar
  // acá es haber escrito la URL.
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('title')} text={body.error?.message} />;
  }

  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <SettingsForm screen={body.data} />
    </>
  );
}
