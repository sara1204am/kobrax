import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { AgendaItemStatus, Permission, todayISO, type AgendaItemDetail, type MeInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { AGENDA_STATUS_TONE, itemActions, itemWhen } from '@/lib/agenda';
import { Badge, Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';
import { ItemActions } from './item-actions';

/** Un ítem del catálogo del tenant (motivos de cancelación y de reprogramación). */
export interface CatalogOption {
  code: string;
  label: string;
}

/**
 * El detalle de una gestión.
 *
 * ⚠️ **Esta llamada revela el documento del deudor en claro y la API lo audita.** Por eso se pide
 * sólo acá, al abrir el detalle, y nunca para pintar una lista: hacerlo en el listado dejaría N
 * revelados auditados por pantalla.
 */
export default async function GestionPage({ params }: { params: { id: string } }) {
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

  const { item, client, credit, target, history } = detail.body.data;
  const canWrite = me.body.data?.permissions?.includes(Permission.AGENDA_WRITE) ?? false;
  const actions = canWrite ? itemActions(item.status) : [];

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

  return (
    <>
      <PageHeader
        title={client.displayName}
        subtitle={`${t(`type.${item.type}`)} · ${item.scheduledDate.slice(0, 10)} · ${when}`}
        actions={
          actions.length > 0 ? (
            <ItemActions
              itemId={item.id}
              type={item.type}
              today={todayISO()}
              cancelReasons={cancelReasons?.body.data ?? []}
              rescheduleReasons={rescheduleReasons?.body.data ?? []}
            />
          ) : undefined
        }
      />

      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={AGENDA_STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Badge>
            {item.isOverdue && item.status === AgendaItemStatus.SCHEDULED && (
              <Badge tone="danger">{t('overdueBadge')}</Badge>
            )}
          </div>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* En claro y auditado: es el dato con el que se identifica al deudor en la puerta. */}
            <Fact label={t('detail.document')} value={client.nationalId ?? '—'} />
            {credit && (
              <>
                <Fact label={t('detail.credit')} value={credit.code ?? credit.creditId} />
                <Fact label={t('detail.balance')} value={money(credit.outstandingBalance, credit.currency)} />
                <Fact label={t('detail.daysPastDue')} value={String(credit.daysPastDue)} />
              </>
            )}
            {target?.phone && <Fact label={t('detail.phone')} value={target.phone} />}
            {target?.address && <Fact label={t('detail.address')} value={target.address} />}
          </dl>

          {item.observations && (
            <div className="mt-5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">
                {t('detail.observations')}
              </p>
              <p className="mt-1 text-[15px] text-k-text">{item.observations}</p>
            </div>
          )}

          {item.rescheduledFromId && <p className="mt-4 text-[13px] text-k-text-2">{t('detail.rescheduledFrom')}</p>}

          <Link
            href={`/mora/${item.caseId}`}
            className="mt-5 inline-block text-[14px] font-medium text-k-purple hover:underline"
          >
            {t('detail.openCase')}
          </Link>
        </Card>

        <section>
          <h2 className="mb-3 text-[18px] font-semibold text-k-navy">{t('detail.history')}</h2>
          {history.length > 0 ? (
            <ul className="space-y-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-k-border bg-white px-5 py-3.5"
                >
                  <span className="text-[14px] text-k-text">
                    {/* El día del agendado no tiene hora: en la zona local se corría un día atrás. */}
                    {t(`type.${entry.type}`)} · {dayDate(entry.scheduledDate, locale)}
                  </span>
                  <Badge tone={AGENDA_STATUS_TONE[entry.status]}>{t(`status.${entry.status}`)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t('detail.historyEmpty')} />
          )}
        </section>
      </div>
    </>
  );
}
