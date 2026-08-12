import { getTranslations } from 'next-intl/server';
import type { LastRun } from '@kobrax/shared';
import { dateTime } from '@/lib/format';

/**
 * La última corrida. Server component: no tiene una sola interacción, así que no viaja como
 * JavaScript al navegador.
 *
 * La API guarda **conteos, no el detalle por fila**, y sólo expone la última. Un histórico de
 * verdad es un endpoint nuevo, así que acá no se finge tenerlo.
 */
export async function LastRunCard({ lastRun }: { lastRun: LastRun | null }) {
  const t = await getTranslations('panel.import');

  return (
    <div className="rounded-2xl border border-k-border bg-white p-6">
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
    </div>
  );
}
