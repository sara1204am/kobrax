import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AccountInfo, Assignee, ConfigScreen, ImportRunSummary, MeInfo } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { HISTORY_PAGE_SIZE, hasHistoryFilters, historyQuery } from '@/lib/import';
import { ImportRunner } from './import-runner';
import { ImportHistoryTable } from './history-table';

/**
 * El import del día. Una sola pantalla con tres estados (elegir · vista previa · resultado) y no
 * cuatro rutas como en el móvil: **un `File` no sobrevive a un `router.push`** — no es
 * serializable y en el navegador no hay `uri` que reabrir. Navegar significaría volver a pedirle
 * el archivo a la persona.
 *
 * Debajo, el historial: cada archivo importado con lo que cambió, y su detalle a un clic.
 */
export default async function ImportPage({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const t = await getTranslations('panel.import');
  const [screen, runs, me, account, assignees] = await Promise.all([
    apiCall<ConfigScreen>('/imports/portfolio/config', { method: 'GET', auth: true }),
    apiCall<ImportRunSummary[]>(`/imports/portfolio/runs?${historyQuery(searchParams)}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    // La moneda de la cuenta: la vista previa muestra saldos.
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    // A quién se le puede asignar lo nuevo. Sin `assignment:write` (el cobrador) es 403 → lista vacía:
    // no reparte, lo nuevo queda a su nombre.
    apiCall<Assignee[]>('/assignments/assignees', { method: 'GET', auth: true }),
  ]);

  if (screen.status !== 200 || !screen.body.data) {
    return <EmptyState title={t('title')} text={screen.body.error?.message} />;
  }
  const { config, members } = screen.body.data;
  const limit = Number(historyQuery(searchParams).get('limit')) || HISTORY_PAGE_SIZE;

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
            {t('settings.link')}
          </Link>
        }
      />
      <div className="space-y-6">
        <ImportRunner
          config={config}
          currency={account.body.data?.currencyCode ?? 'BOB'}
          assignees={assignees.body.data ?? []}
          members={members}
        />

        <section className="space-y-2">
          <h2 className="text-[16px] font-semibold text-k-navy">{t('history.title')}</h2>
          <p className="text-[13px] text-k-text-2">{t('history.hint')}</p>
          {runs.status === 200 && runs.body.data ? (
            <ImportHistoryTable
              rows={runs.body.data}
              meta={pageMeta(runs.body, searchParams.page, limit)}
              userId={me.body.data?.userId}
              hasFilters={hasHistoryFilters(searchParams)}
              importers={members}
            />
          ) : (
            <EmptyState title={t('history.title')} text={runs.body.error?.message} />
          )}
        </section>
      </div>
    </>
  );
}
