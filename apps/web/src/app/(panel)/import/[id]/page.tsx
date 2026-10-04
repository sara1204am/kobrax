import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  IMPORT_RUN_ITEM_ACTIONS,
  type AccountInfo,
  type ConfigScreen,
  type ImportRunCounts,
  type ImportRunItem,
  type ImportRunItemAction,
  type ImportRunSummary,
  type MeInfo,
} from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { isUuid } from '@/lib/uuid';
import { dateTime, dayDate } from '@/lib/format';
import { fileSize, RUN_ITEMS_PAGE_SIZE, runItemAction, runItemsQuery, scopeRefName } from '@/lib/import';
import { RunItemsTable } from './run-items-table';

/** Qué número de la corrida corresponde a cada pestaña. */
const COUNT_OF: Record<ImportRunItemAction, keyof ImportRunCounts> = {
  CREATED: 'created',
  UPDATED: 'updated',
  REAPPEARED: 'reappeared',
  SET_CURRENT: 'setCurrent',
  ABSENT: 'absent',
  REJECTED: 'rejected',
};

/** La explicación de cada pestaña: las mismas que da la vista previa del importador, para no decirlo distinto. */
const HINT_OF: Record<ImportRunItemAction, string> = {
  CREATED: 'run.createdHint',
  UPDATED: 'run.updatedHint',
  REAPPEARED: 'run.reappearedHint',
  SET_CURRENT: 'run.setCurrentHint',
  ABSENT: 'run.absentHint',
  REJECTED: 'run.invalidHint',
};

/**
 * Una importación: quién la hizo, con qué documento —para verlo o bajarlo— y qué le pasó a cada
 * registro.
 *
 * Los números son **pestañas**: tocar «Ausentes» deja la tabla sólo con esas. La pestaña vive en
 * la URL (`?action=ABSENT`), así el link del historial abre directo donde hace falta y «atrás»
 * vuelve a la anterior.
 */
export default async function ImportRunPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { action?: string; page?: string; pageSize?: string };
}) {
  const t = await getTranslations('panel.import');
  const locale = await getLocale();
  if (!isUuid(params.id)) notFound();

  const action = runItemAction(searchParams.action);
  const query = runItemsQuery(searchParams);
  const [runRes, itemsRes, account, me, screen] = await Promise.all([
    apiCall<ImportRunSummary>(`/imports/portfolio/runs/${params.id}`, { method: 'GET', auth: true }),
    apiCall<ImportRunItem[]>(`/imports/portfolio/runs/${params.id}/items?${query}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    // Sólo por los nombres: el alcance se guarda como `official:<id>` y se muestra a quién es.
    apiCall<ConfigScreen>('/imports/portfolio/config', { method: 'GET', auth: true }),
  ]);

  if (runRes.status === 404) notFound();
  if (runRes.status !== 200 || !runRes.body.data) {
    return <EmptyState title={t('title')} text={runRes.body.error?.message} />;
  }
  const run = runRes.body.data;
  const currency = account.body.data?.currencyCode ?? 'BOB';
  const fileUrl = `/api/imports/runs/${run.id}/file`;
  // P10: el documento trae la cartera sin enmascarar. Sin `client:pii:read` (el supervisor) se ve el
  // detalle de la corrida pero no el archivo crudo; la API además lo rechaza.
  const canSeeFile = (me.body.data?.permissions ?? []).includes('client:pii:read');
  const total = IMPORT_RUN_ITEM_ACTIONS.reduce((sum, a) => sum + run.counts[COUNT_OF[a]], 0);
  const scopeText = scopeOf(run.scope, screen.body.data, t);

  return (
    <>
      <Link href="/import" className="mb-3 inline-block text-[14px] font-medium text-k-purple hover:underline">
        {t('detail.back')}
      </Link>
      <PageHeader title={t('detail.title', { date: dateTime(run.at, locale) })} subtitle={run.file?.name} />

      <div className="space-y-6">
        <Card>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('detail.by')} value={run.createdBy?.name ?? t('detail.unknownUser')} />
            <Fact label={t('detail.reportDate')} value={run.reportDate ? dayDate(run.reportDate, locale) : '—'} />
            <Fact label={t('detail.advisor')} value={run.advisorCode ?? '—'} />
            <Fact label={t('detail.scope')} value={scopeText} />
            <Fact
              label={t('detail.file')}
              value={run.file ? `${run.file.name} · ${fileSize(run.file.size)}` : t('detail.noFile')}
            />
          </dl>

          {/* El documento tal cual se subió: se abre en otra pestaña (un PDF se ve ahí mismo) o se baja. */}
          {run.file && canSeeFile && (
            <div className="mt-5 flex flex-wrap gap-4">
              <a href={fileUrl} target="_blank" rel="noreferrer" className="text-[14px] font-medium text-k-purple hover:underline">
                {t('detail.view')}
              </a>
              <a href={`${fileUrl}?download=1`} className="text-[14px] font-medium text-k-purple hover:underline">
                {t('detail.download')}
              </a>
            </div>
          )}
        </Card>

        {!run.itemsComplete && (
          <p className="rounded-2xl border-l-[3px] border-k-warning bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
            {t('detail.partial')}
          </p>
        )}

        <section className="space-y-3">
          <h2 className="text-[16px] font-semibold text-k-navy">{t('detail.movements')}</h2>

          {/* Las pestañas: mismo mosaico que los números de la vista previa del importador. */}
          <nav className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" aria-label={t('detail.movements')}>
            <Tab href={`/import/${run.id}`} label={t('detail.all')} value={total} active={!action} />
            {IMPORT_RUN_ITEM_ACTIONS.map((a) => (
              <Tab
                key={a}
                href={`/import/${run.id}?action=${a}`}
                label={t(`detail.tabs.${a}`)}
                value={run.counts[COUNT_OF[a]]}
                active={action === a}
                danger={a === 'REJECTED'}
              />
            ))}
          </nav>

          {action && <p className="text-[13px] text-k-text-2">{t(HINT_OF[action])}</p>}

          {itemsRes.status === 200 && itemsRes.body.data ? (
            <RunItemsTable
              rows={itemsRes.body.data}
              meta={pageMeta(itemsRes.body, searchParams.page, Number(query.get('limit')) || RUN_ITEMS_PAGE_SIZE)}
              currency={currency}
              showAction={!action}
              userId={me.body.data?.userId}
            />
          ) : (
            <EmptyState title={t('detail.movements')} text={itemsRes.body.error?.message} />
          )}
        </section>
      </div>
    </>
  );
}

/** `official:<id>` → «Cartera de Carlos Collector»; `account` → «Toda la empresa». */
function scopeOf(
  scope: string | null,
  screen: ConfigScreen | null | undefined,
  t: Awaited<ReturnType<typeof getTranslations<'panel.import'>>>,
): string {
  if (!scope) return '—';
  const [kind, ref = null] = scope.split(':') as ['account' | 'official' | 'branch', string | undefined];
  if (kind === 'account') return t('detail.scopeKinds.account');
  const name = screen ? scopeRefName({ kind, ref }, screen.members, screen.branches, t) : null;
  return t(`detail.scopeKinds.${kind === 'branch' ? 'branch' : 'official'}`, { name: name ?? ref ?? '—' });
}

function Tab({
  href,
  label,
  value,
  active,
  danger,
}: {
  href: string;
  label: string;
  value: number;
  active: boolean;
  danger?: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`rounded-xl border px-4 py-3 transition-colors ${
        active ? 'border-k-purple bg-k-highlight' : 'border-transparent bg-k-bg hover:border-k-border'
      }`}
    >
      <span className="block text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{label}</span>
      <span className={`mt-1 block text-[22px] font-semibold tabular-nums ${danger && value > 0 ? 'text-k-danger' : 'text-k-navy'}`}>
        {value}
      </span>
    </Link>
  );
}
