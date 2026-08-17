import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ClientDetail, ClientTimelineEntry, Member } from '@kobrax/shared';
import { fullName } from '@/lib/format';
import { apiCall, pageMeta } from '@/lib/bff';
import { PageHeader } from '@/components/panel-ui';
import { RetryState } from '@/components/retry-state';
import { TimelineSection } from '../timeline-section';

const LIMIT = 50;

/**
 * La bitácora completa: **todo lo que se hizo con esta persona**, de todos sus créditos.
 *
 * Es la pantalla del «Ver todo» de la ficha. Existe por una razón concreta: el resumen corta en
 * ocho, y saber qué se intentó con un deudor —cuántas veces se lo llamó, cuándo prometió y no
 * pagó— es lo que decide si hoy se lo visita o se lo manda a legal.
 *
 * 🔴 **Pagina de verdad, contra la base.** El endpoint une las tres fuentes con `UNION ALL` y ordena
 * ahí: traer «las últimas de cada una» y mezclarlas acá daría una segunda página que miente.
 */
export default async function BitacoraPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { page?: string };
}) {
  const t = await getTranslations('portfolio');
  const page = Math.max(1, Number(searchParams.page) || 1);

  const [client, timeline, team] = await Promise.all([
    apiCall<ClientDetail>(`/clients/${params.id}`, { method: 'GET', auth: true }),
    apiCall<ClientTimelineEntry[]>(`/clients/${params.id}/timeline?page=${page}&limit=${LIMIT}`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  if (client.status === 404) notFound();
  if (client.status !== 200 || !client.body.data) {
    return <RetryState title={t('noAccess')} text={client.body.error?.message} />;
  }

  const meta = pageMeta(timeline.body, searchParams.page, LIMIT);

  return (
    <>
      <PageHeader
        title={t('sections.timeline')}
        subtitle={fullName(client.body.data)}
        actions={
          <Link
            href={`/cartera/${params.id}`}
            className="flex h-9 items-center rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg"
          >
            {t('backToClient')}
          </Link>
        }
      />

      <TimelineSection entries={timeline.body.data ?? []} members={team.body.data ?? []} denied={timeline.status === 403} />

      {/* Paginación simple: la bitácora se lee de lo último hacia atrás, no se ordena ni se filtra,
          así que el `DataTable` acá sería traer una tabla entera para dibujar dos botones. */}
      {meta.pages > 1 && (
        <nav className="mt-4 flex items-center justify-between gap-3" aria-label={t('sections.timeline')}>
          <p className="text-[13px] text-k-text-2">{t('page', { page: meta.page, pages: meta.pages })}</p>
          <span className="flex gap-2">
            <PageLink id={params.id} page={meta.page - 1} disabled={meta.page <= 1} label={t('previous')} />
            <PageLink id={params.id} page={meta.page + 1} disabled={meta.page >= meta.pages} label={t('next')} />
          </span>
        </nav>
      )}
    </>
  );
}

function PageLink({ id, page, disabled, label }: { id: string; page: number; disabled: boolean; label: string }) {
  const clase = 'min-h-[36px] rounded-lg border border-k-border px-3 text-[13px] font-medium';
  // Deshabilitado es un `<span>`, no un `<a>` apagado: un link que no lleva a ningún lado igual se
  // puede tocar con el teclado y confunde a quien navega sin ver.
  if (disabled) return <span className={`${clase} flex items-center text-k-muted opacity-40`}>{label}</span>;
  return (
    <Link href={`/cartera/${id}/bitacora?page=${page}`} className={`${clase} flex items-center text-k-text-2 hover:bg-k-bg`}>
      {label}
    </Link>
  );
}
