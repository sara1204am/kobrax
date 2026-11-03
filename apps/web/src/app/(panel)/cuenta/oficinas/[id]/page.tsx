import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Badge, EmptyState, Section } from '@/components/panel-ui';
import { dateTime } from '@/lib/format';
import { parseOfficeDetail, type OfficeRow, type OfficeType } from '@/lib/offices';
import { DetailActions, DetailTeam } from './detail-actions';

/**
 * Detalle de una oficina: ruta completa, datos, estadísticas (personas, créditos, mora, hijas), sub-oficinas, equipo e
 * historial de auditoría. Lo que Gallium llama «Relaciones» (beneficiarios, documentos) acá son personas y créditos.
 */
export default async function OfficeDetailPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('account.offices');
  const locale = await getLocale();
  const [found, list, members, types] = await Promise.all([
    apiCall<Record<string, unknown>>(`/branches/${encodeURIComponent(params.id)}`, { method: 'GET', auth: true }),
    apiCall<OfficeRow[]>('/branches', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<OfficeType[]>('/branch-types', { method: 'GET', auth: true }),
  ]);

  if (found.status === 404 || found.status === 400) notFound();
  if (found.status !== 200 || !found.body.data || !list.body.data) {
    return (
      <>
        <Link href="/cuenta/oficinas" className="mb-3 inline-block text-[13px] font-medium text-k-purple hover:underline">
          ← {t('detail.back')}
        </Link>
        <EmptyState title={t('detail.noAccess')} text={found.body.error?.message} />
      </>
    );
  }

  const o = parseOfficeDetail(found.body.data);
  const rows = list.body.data;
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parent = o.parentId ? byId.get(o.parentId) : undefined;
  const children = rows.filter((r) => r.parentId === o.id && r.active);
  // Los ancestros, para que la ruta completa sea navegable (R10).
  const ancestors = o.path
    .split('/')
    .filter(Boolean)
    .slice(0, -1)
    .map((id) => byId.get(id))
    .filter((x): x is OfficeRow => !!x);
  const facts: [string, string | null][] = [
    [t('form.fields.code'), o.code],
    [t('form.fields.type'), o.typeName],
    [t('form.fields.city'), o.city],
    [t('form.fields.address'), o.address],
    [t('form.fields.manager'), o.managerName ?? null],
  ];
  const stats: [string, number | null][] = [
    [t('detail.stats.members'), o.stats.members],
    [t('detail.stats.credits'), o.stats.credits],
    [t('detail.stats.arrears'), o.stats.arrears],
    [t('detail.stats.children'), o.stats.children || children.length],
  ];

  return (
    <div className="space-y-6">
      <nav aria-label={t('detail.path')} className="flex flex-wrap items-center gap-1 text-[13px] text-k-text-2">
        <Link href="/cuenta/oficinas" className="font-medium text-k-purple hover:underline">
          {t('title')}
        </Link>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <span aria-hidden>›</span>
            <Link href={`/cuenta/oficinas/${a.id}`} className="hover:underline">
              {a.name}
            </Link>
          </span>
        ))}
        <span aria-hidden>›</span>
        <span aria-current="page" className="font-medium text-k-text">
          {o.name}
        </span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-k-border bg-white p-5">
        <div className="min-w-0">
          <h2 className="truncate text-[22px] font-semibold text-k-navy">{o.name}</h2>
          <p className="mt-1 text-[13px] text-k-text-2">{o.isRoot ? t('tree.root') : o.fullName}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge dot tone={o.active ? 'success' : 'neutral'}>
              {o.active ? t('status.active') : t('status.inactive')}
            </Badge>
            {o.typeName && <Badge>{o.typeName}</Badge>}
            {o.code && <Badge>{o.code}</Badge>}
          </div>
          {parent && (
            <p className="mt-3 text-[13px] text-k-text-2">
              {t('detail.parent')}{' '}
              <Link href={`/cuenta/oficinas/${parent.id}`} className="font-medium text-k-purple hover:underline">
                {parent.fullName || parent.name}
              </Link>
            </p>
          )}
        </div>
        <DetailActions office={o} rows={rows} types={types.body.data ?? []} members={members.body.data ?? []} />
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={t('detail.general')} inner="p-5">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {facts.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{k}</dt>
                <dd className="mt-1 break-words text-[14px] text-k-text">{v || <span className="text-k-muted">—</span>}</dd>
              </div>
            ))}
          </dl>
        </Section>
        <div className="space-y-6">
          <Section title={t('detail.statsTitle')} inner="p-5">
            <dl className="grid grid-cols-2 gap-4">
              {stats.map(([k, v]) => (
                <div key={k} className="rounded-xl bg-k-bg px-4 py-3">
                  <dt className="text-[12px] text-k-text-2">{k}</dt>
                  <dd className="mt-1 text-[22px] font-semibold tabular-nums text-k-navy">{v ?? '—'}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title={t('detail.children')} inner="p-5">
            {children.length === 0 ? (
              <p className="text-[13px] text-k-text-2">{t('detail.noChildren')}</p>
            ) : (
              <ul className="space-y-1">
                {children.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link href={`/cuenta/oficinas/${c.id}`} className="text-[14px] text-k-purple hover:underline">
                      {c.name}
                    </Link>
                  </li>
                ))}
                {children.length > 6 && <li className="text-[13px] text-k-text-2">{t('detail.andMore', { n: children.length - 6 })}</li>}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <Section title={t('detail.team')} inner="p-5">
        <DetailTeam office={o} rows={rows} members={members.body.data ?? []} />
      </Section>

      <Section title={t('detail.history')} inner="p-5">
        {o.history.length === 0 ? (
          <p className="text-[13px] text-k-text-2">{t('detail.noHistory')}</p>
        ) : (
          <ol className="divide-y divide-k-border">
            {o.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[13px]">
                <span className="text-k-text">
                  <span className="font-medium">{h.action}</span>
                  {h.summary ? ` — ${h.summary}` : ''}
                </span>
                <span className="text-k-text-2">
                  {h.actorName ? `${h.actorName} · ` : ''}
                  {dateTime(h.at, locale)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
