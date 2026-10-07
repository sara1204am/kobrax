import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  AgendaItemStatus,
  AgendaItemType,
  Permission,
  todayISO,
  type AgendaHistoryEntry,
  type AgendaItemDetail,
  type MeInfo,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAgendaSummary } from '@/lib/agenda-summary';
import { AGENDA_STATUS_TONE, entrySummary, itemActions, itemWhen } from '@/lib/agenda';
import { Badge, EmptyState } from '@/components/panel-ui';
import { dateTime, dayDate, money } from '@/lib/format';
import { ContactActions } from './contact-actions';
import { ItemActions } from './item-actions';

const INITIAL_ACTIONS: Record<string, 'complete' | 'reschedule' | 'cancel' | 'edit' | 'delete'> = {
  completar: 'complete',
  reagendar: 'reschedule',
  cancelar: 'cancel',
  editar: 'edit',
  eliminar: 'delete',
};

/** Un ítem del catálogo del tenant (motivos de cancelación y de reprogramación). */
export interface CatalogOption {
  code: string;
  label: string;
}

/** Un dato con su rótulo, en la rejilla de una tarjeta. `dark` es la tarjeta azul. */
function Datum({ label, children, dark = false }: { label: string; children: React.ReactNode; dark?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className={`text-[12px] ${dark ? 'text-white/65' : 'text-k-text-2'}`}>{label}</dt>
      <dd className={`mt-1 text-[16px] font-medium ${dark ? 'text-white' : 'text-k-text'}`}>{children}</dd>
    </div>
  );
}

/**
 * El detalle de una gestión.
 *
 * Tres bloques, en este orden: el crédito (tarjeta azul, la misma de la ficha de cartera: es lo que se
 * mira de lejos), la gestión misma, y la línea de tiempo de la cobranza con ESTA gestión resaltada.
 *
 * ⚠️ **Esta llamada revela el documento del deudor en claro y la API lo audita.** Por eso se pide
 * sólo acá, al abrir el detalle, y nunca para pintar una lista: hacerlo en el listado dejaría N
 * revelados auditados por pantalla.
 */
export default async function GestionPage({
  params,
  searchParams,
}: {
  params: { id: string };
  /** `?accion=` — desde el menú «⋮» de la lista: abre directo el diálogo pedido. */
  searchParams: { accion?: string };
}) {
  const t = await getTranslations('panel.agenda');
  const locale = await getLocale();

  const [detail, me] = await Promise.all([
    apiCall<AgendaItemDetail>(`/agenda/${params.id}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);

  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('title')} text={detail.body.error?.message} />;
  }

  const { item, client, credit, target, labels, history, execution, rescheduledTo, route } = detail.body.data;
  const canWrite = me.body.data?.permissions?.includes(Permission.AGENDA_WRITE) ?? false;
  const actions = canWrite ? itemActions(item.status) : [];
  /**
   * Editar y eliminar son de quien la creó (y mientras está pendiente): ni el responsable a quien se la
   * asignaron ni un administrador. La API lo hace cumplir con un 403; acá sólo no se ofrece lo que rebotaría.
   */
  const canEdit = canWrite && item.canEdit === true;

  // Los motivos los pone el tenant, no el panel. Se piden sólo si hay algo que motivar; sin
  // `catalog:read` vuelven vacíos y el modal lo dice en vez de ofrecer un desplegable mudo.
  const [cancelReasons, rescheduleReasons] = await Promise.all(
    actions.length > 0
      ? [
          apiCall<CatalogOption[]>('/catalogs/CANCEL_REASON', { method: 'GET', auth: true }),
          apiCall<CatalogOption[]>('/catalogs/RESCHEDULE_REASON', { method: 'GET', auth: true }),
        ]
      : [],
  );

  const when = itemWhen(item, t);
  const currency = credit?.currency;
  const d = item.details as Record<string, unknown>;
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

  /** Lo propio de cada tipo, además de tipo/fecha/momento. */
  const reminder = item.type === AgendaItemType.REMINDER ? text(d.description) : undefined;
  const message = item.type === AgendaItemType.WHATSAPP ? text(d.message) : undefined;
  const promise =
    item.type === AgendaItemType.PROMISE_TO_PAY && typeof d.amount === 'number'
      ? {
          amount: money(d.amount, currency),
          date: typeof d.promiseDate === 'string' ? dayDate(d.promiseDate, locale) : undefined,
          method: text(d.paymentMethodCode) ? (labels?.[String(d.paymentMethodCode)] ?? String(d.paymentMethodCode)) : undefined,
        }
      : undefined;

  /**
   * La línea de tiempo, en dos grupos: PRÓXIMAS (pendientes, la más cercana primero) e HISTORIAL (lo que ya pasó, lo más
   * reciente primero). Cada gestión cae siempre en el mismo grupo y lugar, esté o no seleccionada: al tocar otra solo
   * cambia cuál está resaltada, nada salta de sitio.
   */
  const rows: (AgendaHistoryEntry & { current?: boolean })[] = [
    {
      id: item.id,
      type: item.type,
      status: item.status,
      scheduledDate: item.scheduledDate,
      isOverdue: item.isOverdue,
      timeMode: item.timeMode,
      scheduledTime: item.scheduledTime,
      timeSlot: item.timeSlot,
      observations: item.observations,
      details: item.details,
      current: true,
    },
    ...history,
  ];
  const byDate =
    (dir: 1 | -1) =>
    (a: AgendaHistoryEntry, b: AgendaHistoryEntry): number =>
      dir * (a.scheduledDate.localeCompare(b.scheduledDate) || (a.scheduledTime ?? '').localeCompare(b.scheduledTime ?? '') || a.id.localeCompare(b.id));
  const upcoming = rows.filter((r) => r.status === AgendaItemStatus.SCHEDULED).sort(byDate(1));
  const past = rows.filter((r) => r.status !== AgendaItemStatus.SCHEDULED).sort(byDate(-1));
  /** Las que se ven de entrada en el historial; el resto, plegado: la línea de tiempo no debe ser una lista pesada. */
  const PAST_VISIBLE = 8;

  const outcomeLabel = (code?: string): string | undefined => (code ? (t.has(`outcome.${code}`) ? t(`outcome.${code}`) : code) : undefined);
  const reasonLabel =
    item.reasonCode && (item.status === AgendaItemStatus.CANCELLED || item.status === AgendaItemStatus.RESCHEDULED)
      ? (labels?.[item.reasonCode] ?? item.reasonCode)
      : undefined;

  /** Una fila de la línea de tiempo: la gestión, su estado y, si ya se hizo, su resultado. */
  const renderRow = (r: AgendaHistoryEntry & { current?: boolean }) => {
    const line = entrySummary(r, currency, (amount) => t('detail.promiseSummary', { amount }), (n, c) => money(n, c));
    const result = outcomeLabel(r.outcome);
    const body = (
      <>
        <span className="relative z-10 grid h-9 w-9 shrink-0 place-items-center">
          <span
            aria-hidden
            className={`h-4 w-4 rounded-full border-2 ${
              r.current ? 'border-k-periwinkle bg-white ring-4 ring-k-periwinkle/25' : 'border-k-soft-periw bg-white'
            }`}
          />
        </span>
        <span className="w-28 shrink-0">
          <span className="block text-[14px] font-semibold text-k-text">{dayDate(r.scheduledDate, locale)}</span>
          <span className="block text-[13px] text-k-text-2">{itemWhen(r as never, t)}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-k-text">{t(`type.${r.type}`)}</span>
          {line && <span className="block truncate text-[13px] text-k-text-2">{line}</span>}
          {result && (
            <span className="block truncate text-[13px] text-k-success">
              {t('detail.result')}: {result}
            </span>
          )}
        </span>
        <Badge tone={AGENDA_STATUS_TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
      </>
    );
    const cls = `flex items-center gap-3 rounded-xl px-2 py-2.5 ${r.current ? 'bg-k-info-bg' : 'hover:bg-k-bg'}`;
    return (
      <li key={r.id}>
        {r.current ? (
          <div aria-current="true" className={cls}>
            {body}
          </div>
        ) : (
          <Link href={`/agenda/${r.id}`} scroll={false} className={cls}>
            {body}
          </Link>
        )}
      </li>
    );
  };
  /** El hilo que une los puntos: pasa por detrás y se corta en el primero y el último. */
  const thread = <span aria-hidden className="absolute bottom-7 left-[25px] top-7 w-0.5 bg-k-light-bg" />;
  const groupTitle = 'mb-1 text-[12px] font-semibold uppercase tracking-wide text-k-text-2';

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold tracking-tight text-k-navy">{client.displayName}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] text-k-text-2">
            <span>{t(`type.${item.type}`)}</span>
            <span aria-hidden>·</span>
            <span>{dayDate(item.scheduledDate, locale)}</span>
            <span aria-hidden>·</span>
            <span>{when}</span>
            <span aria-hidden>·</span>
            <Badge tone={AGENDA_STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Badge>
            {item.isOverdue && item.status === AgendaItemStatus.SCHEDULED && <Badge tone="danger">{t('overdueBadge')}</Badge>}
          </p>
        </div>
        {(actions.length > 0 || canEdit || item.status === AgendaItemStatus.SCHEDULED) && (
          <div className="flex flex-wrap items-center gap-2">
            {item.status === AgendaItemStatus.SCHEDULED && (
              <ContactActions
                type={item.type}
                phone={target?.phone}
                message={message}
                latitude={target?.latitude}
                longitude={target?.longitude}
              />
            )}
            <ItemActions
              itemId={item.id}
              type={item.type}
              initialAction={INITIAL_ACTIONS[searchParams.accion ?? '']}
              today={(await getAgendaSummary())?.date ?? todayISO()}
              cancelReasons={cancelReasons?.body.data ?? []}
              rescheduleReasons={rescheduleReasons?.body.data ?? []}
              canExecute={actions.length > 0}
              // Una visita que una ruta lleva se registra en su parada (con GPS y evidencia): acá solo se manda a la ruta.
              routeStopHref={route ? `/rutas/${route.routeId}/parada/${route.stopId}` : undefined}
              editable={canEdit ? item : undefined}
              schedule={{ timeMode: item.timeMode, scheduledTime: item.scheduledTime, timeSlot: item.timeSlot }}
              assign={me.body.data?.permissions?.includes(Permission.AGENDA_ASSIGN) ? { meId: me.body.data.userId } : undefined}
            />
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* La tarjeta azul de la ficha de cartera: lo que se debe, en grande, sobre el mismo fondo del menú. */}
          <section className="rounded-2xl bg-k-navy p-6 text-white">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[18px] font-semibold">{t('detail.creditInfo')}</h2>
              <Link
                href={`/mora/${item.creditId}`}
                className="shrink-0 text-[13px] font-medium text-white/85 hover:text-white hover:underline"
              >
                {t('detail.seeInMora')} →
              </Link>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-white/15 pt-5">
              <Datum dark label={t('detail.credit')}>
                {credit?.code ?? credit?.creditId ?? '—'}
              </Datum>
              <Datum dark label={t('detail.balanceNow')}>
                <span className="text-[22px] font-semibold tabular-nums">
                  {credit ? money(credit.outstandingBalance, credit.currency) : '—'}
                </span>
              </Datum>
              <Datum dark label={t('detail.daysPastDue')}>
                {/* Como en la ficha: en verde si no hay atraso, en rojo si lo hay. */}
                <span className={`tabular-nums ${credit && credit.daysPastDue > 0 ? 'text-k-danger' : 'text-k-success'}`}>
                  {credit?.daysPastDue ?? '—'}
                </span>
              </Datum>
              <Datum dark label={t('detail.document')}>
                {client.nationalId ?? '—'}
              </Datum>
            </dl>
          </section>

          <section className="rounded-2xl border border-k-border bg-white p-6">
            <h2 className="text-[18px] font-semibold text-k-navy">{t('detail.gestion')}</h2>
            <dl className="mt-5 grid grid-cols-3 divide-x divide-k-border">
              <div className="pr-4">
                <Datum label={t('detail.type')}>{t(`type.${item.type}`)}</Datum>
              </div>
              <div className="px-4">
                <Datum label={t('detail.date')}>{dayDate(item.scheduledDate, locale)}</Datum>
              </div>
              <div className="pl-4">
                <Datum label={t('detail.moment')}>{when}</Datum>
              </div>
            </dl>

            <dl className="mt-5 grid gap-x-6 gap-y-4 border-t border-k-border pt-5 sm:grid-cols-2">
              {item.assigneeName && <Datum label={t('detail.assignee')}>{item.assigneeName}</Datum>}
              {item.assignedByName && <Datum label={t('detail.assignedBy')}>{item.assignedByName}</Datum>}
              {target?.phone && <Datum label={t('detail.phone')}>{target.phone}</Datum>}
              {target?.address && <Datum label={t('detail.address')}>{target.address}</Datum>}
              {promise && (
                <>
                  <Datum label={t('detail.amount')}>{promise.amount}</Datum>
                  {promise.date && <Datum label={t('detail.promiseDate')}>{promise.date}</Datum>}
                  {promise.method && <Datum label={t('detail.method')}>{promise.method}</Datum>}
                </>
              )}
            </dl>

            {/* Qué pasó: sin esto una gestión ejecutada solo decía «Ejecutada». */}
            {execution && (
              <div className="mt-5 border-t border-k-border pt-5">
                <p className="text-[13px] text-k-text-2">{t('detail.result')}</p>
                <div className="mt-2 rounded-xl bg-k-success-bg px-4 py-3">
                  <p className="text-[14px] font-semibold text-k-success">{outcomeLabel(execution.outcome) ?? t('status.EXECUTED')}</p>
                  {execution.notes && <p className="mt-1 whitespace-pre-wrap text-[14px] text-k-text">{execution.notes}</p>}
                </div>
                <p className="mt-2 text-[12px] text-k-text-2">
                  {execution.byName
                    ? t('detail.executedBy', { name: execution.byName, date: dateTime(execution.at, locale) })
                    : t('detail.executedOn', { date: dateTime(execution.at, locale) })}
                </p>
              </div>
            )}

            {(reminder || message || item.observations) && (
              <div className="mt-5 space-y-4 border-t border-k-border pt-5">
                {reminder && (
                  <div>
                    <p className="text-[13px] text-k-text-2">{t('detail.remember')}</p>
                    <p className="mt-2 rounded-xl bg-k-bg px-4 py-3 text-[14px] text-k-text">{reminder}</p>
                  </div>
                )}
                {message && (
                  <div>
                    <p className="text-[13px] text-k-text-2">{t('detail.message')}</p>
                    <p className="mt-2 whitespace-pre-wrap rounded-xl bg-k-bg px-4 py-3 text-[14px] text-k-text">{message}</p>
                  </div>
                )}
                {item.observations && (
                  <div>
                    <p className="text-[13px] text-k-text-2">{t('detail.observations')}</p>
                    <p className="mt-2 whitespace-pre-wrap rounded-xl bg-k-bg px-4 py-3 text-[14px] text-k-text">{item.observations}</p>
                  </div>
                )}
              </div>
            )}

            {(reasonLabel || rescheduledTo || item.rescheduledFromId) && (
              <div className="mt-5 space-y-1.5 border-t border-k-border pt-5 text-[13px] text-k-text-2">
                {reasonLabel && (
                  <p>
                    {t('detail.reason')}: <span className="font-medium text-k-text">{reasonLabel}</span>
                  </p>
                )}
                {rescheduledTo && (
                  <p>
                    <Link href={`/agenda/${rescheduledTo.id}`} className="font-medium text-k-periwinkle hover:underline">
                      {t('detail.rescheduledTo', { date: dayDate(rescheduledTo.scheduledDate, locale) })} →
                    </Link>
                  </p>
                )}
                {item.rescheduledFromId && (
                  <p>
                    <Link href={`/agenda/${item.rescheduledFromId}`} className="font-medium text-k-periwinkle hover:underline">
                      {t('detail.rescheduledFrom')} →
                    </Link>
                  </p>
                )}
              </div>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-k-border bg-white p-6">
          <h2 className="mb-4 text-[18px] font-semibold text-k-navy">{t('detail.history')}</h2>
          {upcoming.length > 0 && (
            <>
              <h3 className={groupTitle}>{t('detail.upcoming')}</h3>
              <ol className="relative">
                {thread}
                {upcoming.map(renderRow)}
              </ol>
            </>
          )}
          {past.length > 0 && (
            <>
              <h3 className={`${groupTitle} ${upcoming.length > 0 ? 'mt-5' : ''}`}>{t('detail.past')}</h3>
              <ol className="relative">
                {thread}
                {past.slice(0, PAST_VISIBLE).map(renderRow)}
              </ol>
              {past.length > PAST_VISIBLE && (
                <details className="mt-1">
                  <summary className="cursor-pointer list-none rounded-xl px-2 py-2 text-[13px] font-medium text-k-periwinkle hover:bg-k-bg">
                    {t('detail.showMore', { n: past.length - PAST_VISIBLE })}
                  </summary>
                  <ol className="relative">
                    {thread}
                    {past.slice(PAST_VISIBLE).map(renderRow)}
                  </ol>
                </details>
              )}
            </>
          )}
          {history.length === 0 && <p className="mt-3 text-[13px] text-k-text-2">{t('detail.historyEmpty')}</p>}
        </section>
      </div>
    </>
  );
}
