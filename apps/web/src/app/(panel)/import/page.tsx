import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ConfigScreen } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { ImportRunner } from './import-runner';
import { LastRunCard } from './last-run-card';

/**
 * El import del día. Una sola pantalla con tres estados (elegir · vista previa · resultado) y no
 * cuatro rutas como en el móvil: **un `File` no sobrevive a un `router.push`** — no es
 * serializable y en el navegador no hay `uri` que reabrir. Navegar significaría volver a pedirle
 * el archivo a la persona.
 */
export default async function ImportPage() {
  const t = await getTranslations('panel.import');
  const { status, body } = await apiCall<ConfigScreen>('/imports/portfolio/config', {
    method: 'GET',
    auth: true,
  });

  if (status !== 200 || !body.data) {
    return <EmptyState title={t('title')} text={body.error?.message} />;
  }
  const { config, lastRun } = body.data;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link
            href="/import/ajustes"
            className="min-h-[40px] rounded-xl border border-k-border px-4 py-2 text-[14px] font-medium text-k-text-2 hover:bg-k-bg"
          >
            {t('settings')}
          </Link>
        }
      />
      <div className="space-y-6">
        <ImportRunner config={config} />
        <LastRunCard lastRun={lastRun} />
      </div>
    </>
  );
}
