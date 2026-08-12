import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  memberName,
  partitionDay,
  todayISO,
  Permission,
  type AgendaListItem,
  type MeInfo,
  type Member,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { dayOr, groupByAssignee } from '@/lib/agenda';
import { Card, EmptyState, PageHeader } from '@/components/panel-ui';
import { DayPicker } from '@/components/day-picker';
import { AgendaItemRow } from './agenda-item-row';

/** Cuántas vencidas se traen para la tarjeta. `meta.total` dice cuántas hay de verdad. */
const OVERDUE_LIMIT = 5;

/**
 * Lo agendado de un día.
 *
 * 🔴 **`GET /agenda` sólo toma `date`**: con `agenda:assign` devuelve el día de todo el equipo,
 * mezclado y sin forma de pedir el de una persona. El día no está paginado —se recibe entero—, así
 * que agrupar por cobrador acá es correcto y no esconde nada.
 *
 * El reparto pendiente/hecho lo hace `partitionDay` de `shared`, el mismo que usa el teléfono:
 * **hecho es todo lo que ya no está pendiente**, no sólo lo ejecutado. Con la versión ingenua una
 * gestión cancelada desaparecía del día y cancelar quedaba indistinguible de eliminar.
 */
export default async function AgendaPage({ searchParams }: { searchParams: { date?: string } }) {
  const t = await getTranslations('panel.agenda');
  const today = todayISO();
  const day = dayOr(today, searchParams.date);

  const [list, overdue, me, team] = await Promise.all([
    apiCall<AgendaListItem[]>(`/agenda?date=${day}`, { method: 'GET', auth: true }),
    apiCall<AgendaListItem[]>(`/agenda/overdue?limit=${OVERDUE_LIMIT}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  const members = team.body.data ?? [];
  const nameOf = (id: string) => {
    const found = members.find((m) => m.userId === id);
    return found ? memberName(found) : undefined;
  };
  /*
   * Se agrupa por cobrador sólo si además se pudieron leer los nombres: `GET /users` da 403 sin
   * `user:read`, y agrupar entonces dibujaba un uuid crudo como título de cada grupo. Sin nombres,
   * el día se muestra como una lista sola, que dice menos pero no dice nada falso.
   */
  const supervises = me.body.data?.permissions?.includes(Permission.AGENDA_ASSIGN) ?? false;
  const grouped = supervises && members.length > 0;

  const { pending, done } = partitionDay(list.body.data);
  const overdueTotal = overdue.body.meta?.total ?? overdue.body.data?.length ?? 0;

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {!supervises && (
        <p className="mb-4 rounded-xl border border-k-border bg-k-bg px-4 py-3 text-[13px] text-k-text-2">
          {t('scopedToMine')}
        </p>
      )}

      <DayPicker
        day={day}
        today={today}
        labels={{ previous: t('previousDay'), next: t('nextDay'), today: t('today'), date: t('date') }}
      />

      {overdueTotal > 0 && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[15px] font-semibold text-k-navy">{t('overdue.title')}</p>
            <p className="text-[13px] font-medium text-k-danger">{t('overdue.count', { n: overdueTotal })}</p>
          </div>
          <p className="mt-1 text-[13px] text-k-text-2">{t('overdue.text')}</p>
          <ul className="mt-3 space-y-2">
            {(overdue.body.data ?? []).map((item) => (
              <li key={item.id} className="text-[14px]">
                <Link href={`/agenda/${item.id}`} className="hover:underline">
                  <span className="font-medium text-k-text">{item.clientName ?? '—'}</span>
                  <span className="text-k-text-2"> · {t(`type.${item.type}`)} · {item.scheduledDate.slice(0, 10)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {list.body.data.length === 0 ? (
        <div className="mt-6">
          <EmptyState title={t('empty')} text={t('emptyText')} />
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <Section title={t('pending')} items={pending} nameOf={nameOf} unassigned={t('unassigned')} grouped={grouped} />
          <Section title={t('done')} items={done} nameOf={nameOf} unassigned={t('unassigned')} grouped={grouped} />
        </div>
      )}
    </>
  );
}

/**
 * Un bloque del día. Se agrupa por cobrador **sólo cuando se está supervisando**: para un cobrador
 * el día es suyo y un único grupo con su propio nombre es ruido.
 */
async function Section({
  title,
  items,
  nameOf,
  unassigned,
  grouped,
}: {
  title: string;
  items: AgendaListItem[];
  nameOf: (id: string) => string | undefined;
  unassigned: string;
  grouped: boolean;
}) {
  const t = await getTranslations('panel.agenda');
  if (items.length === 0) return null;

  const groups = grouped ? groupByAssignee(items, nameOf, unassigned) : [{ assigneeId: null, name: '', items }];

  return (
    <section>
      <h2 className="mb-3 text-[18px] font-semibold text-k-navy">
        {title} <span className="tabular-nums text-k-text-2">({items.length})</span>
      </h2>
      <div className="space-y-5">
        {groups.map((group) => (
          <div key={group.assigneeId ?? 'sin-cobrador'}>
            {grouped && (
              <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-k-text-2">
                {group.name} · {t('itemCount', { n: group.items.length })}
              </p>
            )}
            <ul className="space-y-2">
              {group.items.map((item) => (
                <AgendaItemRow key={item.id} item={item} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
