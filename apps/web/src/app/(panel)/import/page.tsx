import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ConfigScreen } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Card, EmptyState, PageHeader } from '@/components/panel-ui';
import { dateTime } from '@/lib/format';
import { ImportRunner } from './import-runner';

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

        {/*
          La última corrida. La API guarda **conteos, no el detalle por fila**, y sólo expone la
          última: un histórico de verdad es un endpoint nuevo, así que acá no se finge tenerlo.
        */}
        <Card>
          <p className="text-[14px] font-medium text-k-text">{t('run.lastRun')}</p>
          {lastRun ? (
            <>
              <p className="mt-1 text-[13px] text-k-text-2">{dateTime(lastRun.at)}</p>
              <p className="mt-2 text-[13px] text-k-text-2">
                {t('run.lastRunCounts', {
                  created: lastRun.created,
                  updated: lastRun.updated,
                  setCurrent: lastRun.setCurrent,
                  errors: lastRun.errors,
                })}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[13px] text-k-text-2">{t('run.lastRunNever')}</p>
          )}
        </Card>
      </div>
    </>
  );
}
