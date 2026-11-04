import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import type { Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Badge, EmptyState } from '@/components/panel-ui';
import { Icon } from '@/components/panel-shell';
import { MapPicker } from '@/components/map-picker';
import { dateTime } from '@/lib/format';
import { branchIds, parseOfficeDetail, type OfficePortfolio, type OfficeRow, type OfficeType } from '@/lib/offices';
import { hasOfficeTeamSearch, officeTeamRows, officeTeamView, type OfficeTeamParams } from '@/lib/office-team-table';
import { DetailActions, DetailTeam } from './detail-actions';
import { OfficeStats } from './office-stats';

type TabKey = 'info' | 'offices' | 'team' | 'history';

/** La caja blanca de cada pestaña: un título y su contenido, igual que la ficha de un miembro de Equipo. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-k-border bg-white">
      <div className="px-6 pt-5">
        <h2 className="text-[18px] font-semibold text-k-navy">{title}</h2>
      </div>
      <div className="px-6 pb-6 pt-4">{children}</div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
      {children}
    </th>
  );
}

/**
 * La ficha de una oficina: cabecera con la cartera siempre a la vista y, debajo, pestañas —Información general, Oficinas,
 * Equipo e Historial— como la ficha de un miembro de Equipo.
 *
 * La pestaña vive en la URL (`?tab=`) y la lee el servidor: el enlace se comparte y «atrás» funciona. La API recorta lo que
 * cada persona puede ver; acá sólo se dibuja.
 */
export default async function OfficeDetailPage({ params, searchParams }: { params: { id: string }; searchParams: { tab?: string } & OfficeTeamParams }) {
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

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'info', label: t('detail.tabs.info') },
    { key: 'offices', label: t('detail.tabs.offices'), count: children.length },
    { key: 'team', label: t('detail.tabs.team'), count: o.membersCount },
    { key: 'history', label: t('detail.tabs.history') },
  ];
  const tab: TabKey = tabs.some((x) => x.key === searchParams.tab) ? (searchParams.tab as TabKey) : 'info';

  const facts: [string, React.ReactNode][] = [
    [t('form.fields.code'), o.code],
    [t('form.fields.type'), o.typeName],
    [t('form.fields.city'), o.city],
    [t('form.fields.address'), o.address],
    [t('form.fields.manager'), o.managerName ?? null],
    [t('detail.parentLabel'), parent ? <Link key="p" href={`/cuenta/oficinas/${parent.id}`} className="font-medium text-k-purple hover:underline">{parent.fullName || parent.name}</Link> : null],
  ];
  const hasPoint = typeof o.latitude === 'number' && typeof o.longitude === 'number';

  // El equipo con su cartera: búsqueda global y orden salen de la URL (sin filtros), como la tabla de Equipo.
  const portfolios: Record<string, OfficePortfolio> = Object.fromEntries(o.membersList.flatMap((m) => (m.portfolio ? [[m.userId, m.portfolio] as const] : [])));
  // El equipo es el de TODO el subárbol: en una regional, el personal de sus agencias (cada fila dice de cuál).
  const subtree = new Set(branchIds(rows, o.id));
  const teamMembers = (members.body.data ?? []).filter((m) => m.isActive && !!m.branchId && subtree.has(m.branchId));
  const teamPage = officeTeamView(officeTeamRows(teamMembers, portfolios, rows), searchParams);
  const teamTable = { ...teamPage, searching: hasOfficeTeamSearch(searchParams) };

  let body: React.ReactNode;
  if (tab === 'offices') {
    body = (
      <Panel title={t('detail.children')}>
        {children.length === 0 ? (
          <p className="text-[13px] text-k-text-2">{t('detail.noChildren')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-[14px]">
              <thead>
                <tr className="border-b border-k-border">
                  <Th>{t('detail.columns.name')}</Th>
                  <Th>{t('detail.columns.type')}</Th>
                  <Th>{t('detail.columns.city')}</Th>
                  <Th>{t('detail.columns.manager')}</Th>
                  <Th>{t('detail.columns.members')}</Th>
                  <Th>{t('detail.columns.credits')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-k-border">
                {children.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-3">
                      <Link href={`/cuenta/oficinas/${c.id}`} className="font-medium text-k-navy hover:underline">
                        {c.name}
                      </Link>
                      {c.code && <span className="ml-2 rounded-md bg-k-light-bg/60 px-1.5 py-0.5 text-[12px] text-k-slate">{c.code}</span>}
                    </td>
                    <td className="px-3 py-3 text-k-text-2">{c.typeName ?? '—'}</td>
                    <td className="px-3 py-3 text-k-text-2">{c.city ?? '—'}</td>
                    <td className="px-3 py-3 text-k-text-2">{c.managerName ?? '—'}</td>
                    <td className="px-3 py-3 tabular-nums text-k-text">{c.members}</td>
                    <td className="px-3 py-3 tabular-nums text-k-text">{c.credits}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    );
  } else if (tab === 'team') {
    body = (
      <Panel title={t('detail.team')}>
        <DetailTeam office={o} rows={rows} members={members.body.data ?? []} table={teamTable} />
      </Panel>
    );
  } else if (tab === 'history') {
    body = (
      <Panel title={t('detail.history')}>
        {o.history.length === 0 ? (
          <p className="text-[13px] text-k-text-2">{t('detail.noHistory')}</p>
        ) : (
          <ol className="divide-y divide-k-border">
            {o.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-[13px]">
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
      </Panel>
    );
  } else {
    body = (
      <Panel title={t('detail.general')}>
        <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{k}</dt>
              <dd className="mt-1 break-words text-[15px] text-k-text">{v || <span className="text-k-muted">—</span>}</dd>
            </div>
          ))}
        </dl>
        {hasPoint && (
          <div className="mt-6">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('form.fields.location')}</p>
            <MapPicker label={t('form.fields.locationMap')} height={260} latitude={o.latitude ?? undefined} longitude={o.longitude ?? undefined} />
            <p className="mt-2 text-[12px] text-k-text-2">
              {o.latitude}, {o.longitude}
            </p>
          </div>
        )}
      </Panel>
    );
  }

  return (
    <>
      <nav aria-label={t('detail.path')} className="mb-4 flex flex-wrap items-center gap-1 text-[13px] text-k-text-2">
        <Link href="/cuenta/oficinas" className="font-medium text-k-periwinkle hover:underline">
          ← {t('title')}
        </Link>
        {ancestors.map((a) => (
          <span key={a.id} className="flex items-center gap-1">
            <span aria-hidden>/</span>
            <Link href={`/cuenta/oficinas/${a.id}`} className="hover:underline">
              {a.name}
            </Link>
          </span>
        ))}
        <span aria-hidden>/</span>
        <span aria-current="page" className="text-k-text">
          {o.name}
        </span>
      </nav>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-5">
          <span aria-hidden className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-k-light-bg/70 text-k-periwinkle">
            <Icon name="account" className="h-8 w-8" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[26px] font-semibold tracking-tight text-k-navy">{o.name}</h1>
              <Badge dot tone={o.active ? 'success' : 'neutral'}>
                {o.active ? t('status.active') : t('status.inactive')}
              </Badge>
              {o.typeName && <Badge>{o.typeName}</Badge>}
              {o.code && <Badge>{o.code}</Badge>}
            </div>
            <p className="mt-1 text-[14px] text-k-text-2">{o.isRoot ? t('tree.root') : o.fullName}</p>
            {o.managerName && (
              <p className="mt-1 text-[13px] text-k-text-2">
                {t('form.fields.manager')}: <span className="font-medium text-k-text">{o.managerName}</span>
              </p>
            )}
          </div>
        </div>
        <DetailActions office={o} rows={rows} types={types.body.data ?? []} members={members.body.data ?? []} />
      </header>

      <OfficeStats portfolio={o.portfolio} />

      <nav aria-label={t('detail.sections')} className="mb-5 flex gap-1 overflow-x-auto border-b border-k-border">
        {tabs.map((x) => (
          <Link
            key={x.key}
            href={x.key === 'info' ? `/cuenta/oficinas/${o.id}` : `/cuenta/oficinas/${o.id}?tab=${x.key}`}
            aria-current={tab === x.key ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-[14px] font-medium ${
              tab === x.key ? 'border-k-periwinkle text-k-navy' : 'border-transparent text-k-text-2 hover:text-k-text'
            }`}
          >
            {x.label}
            {x.count !== undefined && <span className="ml-1.5 text-k-muted">{x.count}</span>}
          </Link>
        ))}
      </nav>

      {body}
    </>
  );
}
