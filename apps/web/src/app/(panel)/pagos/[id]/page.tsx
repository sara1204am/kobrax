import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  isCreditSource,
  type AccountInfo,
  type ClientDetail,
  type CreditDetail,
  type MeInfo,
  type PaymentItem,
  type PaymentMethod,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { isUuid } from '@/lib/payments';
import { dateTime, dateTimeLong, fullName, money } from '@/lib/format';
import { ReceiptButton } from './receipt-button';

/**
 * Un pago y su comprobante.
 *
 * Acá **sí** aparece el nombre del deudor, que la lista no muestra: el ledger devuelve `creditId`,
 * no el nombre, y resolverlo por fila serían dos llamadas por pago —cuarenta por página—. Una fila
 * sola se lo puede permitir, y es la pantalla donde el nombre hace falta de verdad.
 *
 * Los nombres de quien registró y de quien cobró **vienen en el pago** (`registeredByName`, `visit.collectorName`): no se
 * pide `/users`, que da 403 sin `user:read` y dejaba a un cobrador mirando «alguien del equipo».
 *
 * 🔴 **No hay nada que editar ni que anular**: `payments` no tiene `update` ni `delete`. Un pago mal
 * cargado se corrige con otro asiento, y la pantalla lo dice en vez de dejarlo suponer.
 */
export default async function PagoPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('panel.payments');
  const tsrc = await getTranslations('creditSource');
  const locale = await getLocale();

  // `/pagos/loquesea` cae acá por el segmento dinámico: sin esto se le pedía a la API un id que no
  // es uno y la pantalla mostraba el texto crudo de una validación. Un id que no existe es un 404.
  if (!isUuid(params.id)) notFound();

  const [detail, account, me] = await Promise.all([
    apiCall<PaymentItem>(`/payments/${params.id}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);

  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('detail.title')} text={detail.body.error?.message} />;
  }
  const payment = detail.body.data;

  // El crédito primero y el deudor después: el pago no trae el cliente, lo trae el crédito. Son dos
  // llamadas encadenadas y no hay forma de ahorrárselas — por eso esto no se hace por fila.
  const credit = (await apiCall<CreditDetail>(`/credits/${payment.creditId}`, { method: 'GET', auth: true })).body.data;
  const client = credit?.clientId
    ? (await apiCall<ClientDetail>(`/clients/${credit.clientId}`, { method: 'GET', auth: true })).body.data
    : null;

  const currency = credit?.currency ?? account.body.data?.currencyCode ?? 'BOB';
  const registeredBy = payment.registeredByName ?? t('unknownUser');
  // Quien cobró: el de la visita si la hubo (el panel carga visitas a nombre de un cobrador); si no, quien lo registró.
  const collector = payment.visit?.collectorName ?? registeredBy;
  const source = credit?.externalSource
    ? isCreditSource(credit.externalSource)
      ? tsrc(credit.externalSource)
      : credit.externalSource
    : tsrc('KOBRAX');
  const title = payment.receiptNumber != null ? t('detail.pageTitle', { n: payment.receiptNumber }) : t('detail.title');
  const who = [client ? fullName(client) : null, credit?.code ? t('detail.creditLine', { code: credit.code }) : null].filter(Boolean).join(' · ');

  // El enlace a la parada sólo si hay a dónde ir y quien mira puede abrir rutas: si no, un 403 detrás de un clic.
  const canRoutes = (me.body.data?.permissions ?? []).includes('route:read');
  const visit = payment.visit;
  const visitHref = canRoutes && visit?.routeId && visit.stopId ? `/rutas/${visit.routeId}/parada/${visit.stopId}` : null;

  return (
    <div className="overflow-hidden rounded-3xl border border-k-border bg-white shadow-k-card">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-k-border px-6 py-5">
        <div className="min-w-0">
          <h1 className="text-[28px] font-semibold leading-tight text-k-navy">{title}</h1>
          {who && <p className="mt-1 text-[16px] text-k-text-2">{who}</p>}
          <p className="mt-0.5 text-[14px] text-k-text-2">
            {t('detail.registeredLine', { date: dateTime(payment.paymentDate, locale), name: registeredBy })}
          </p>
        </div>
        {payment.receiptUrl && <ReceiptButton url={payment.receiptUrl} title={title} caption={t('detail.receiptCaption')} />}
      </header>

      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* El monto y lo que lo identifica: lo primero que se busca en un pago. */}
        <section className="flex flex-col rounded-2xl bg-gradient-to-br from-[#173F63] to-[#0E2D4A] p-6 text-white">
          <p className="text-[13px] text-[#CFE3F7]">{t('detail.amount')}</p>
          <p className="mt-1 text-[40px] font-semibold leading-tight tabular-nums">{money(payment.amount, currency)}</p>

          <div className="mt-5 border-t border-white/20 pt-4">
            <p className="text-[13px] text-[#CFE3F7]">{t('detail.method')}</p>
            <p className="mt-1 flex items-center gap-2.5 text-[18px] font-medium">
              <MethodIcon method={payment.method} />
              {t(`method.${payment.method}`)}
            </p>
          </div>

          <div className="mt-4 border-t border-white/20 pt-4">
            <p className="text-[13px] text-[#CFE3F7]">{t('detail.receiptRef')}</p>
            <p className="mt-1 break-all text-[18px] font-medium">{payment.receiptReference ?? '—'}</p>
          </div>
        </section>

        {/* Nueve datos en una rejilla: el hueco entre celdas es la línea que las separa. */}
        <dl className="grid h-fit grid-cols-1 gap-px overflow-hidden rounded-2xl border border-k-border bg-k-border sm:grid-cols-2 xl:grid-cols-3">
          <Cell label={t('detail.effectiveDate')}>
            <span className="flex items-center gap-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-k-text-2">
                <rect x="4" y="5" width="16" height="15" rx="2" />
                <path d="M4 10h16M9 3v4M15 3v4" />
              </svg>
              {dateTimeLong(payment.paymentDate, locale)}
            </span>
          </Cell>
          <Cell label={t('detail.receiptNumber')}>{payment.receiptNumber != null ? `#${payment.receiptNumber}` : '—'}</Cell>
          <Cell label={t('detail.registeredBy')}>{registeredBy}</Cell>
          <Cell label={t('detail.collector')}>{collector}</Cell>
          <Cell label={t('detail.source')}>{source}</Cell>
          <Cell label={t('detail.provider')}>{payment.provider ?? '—'}</Cell>
          <Cell label={t('detail.externalId')}>{payment.externalTransactionId ?? '—'}</Cell>
          <Cell label={t('detail.visit')}>{payment.visitId ? `#${payment.visitId.slice(0, 8).toUpperCase()}` : '—'}</Cell>
          <Cell label={t('detail.registeredVia')}>{payment.registeredVia ? t(`detail.via.${payment.registeredVia}`) : '—'}</Cell>
        </dl>
      </div>

      <nav aria-label={t('detail.links')} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-4 pt-2 text-[14px] font-medium">
        {credit?.clientId && (
          <>
            <Link href={`/cartera/${credit.clientId}/credito/${payment.creditId}`} className="text-k-periwinkle hover:underline">
              {t('detail.linkCredit')}
            </Link>
            <span aria-hidden className="h-4 w-px bg-k-border" />
          </>
        )}
        {/* F4/08: la gestión cuelga del crédito, no de un caso: siempre hay a dónde ir. */}
        <Link href={`/mora/${payment.creditId}`} className="text-k-periwinkle hover:underline">
          {t('detail.linkMora')}
        </Link>
        <span aria-hidden className="h-4 w-px bg-k-border" />
        {visitHref ? (
          <Link href={visitHref} className="text-k-periwinkle hover:underline">
            {t('detail.linkVisit')}
          </Link>
        ) : (
          <span className="text-k-muted" title={payment.visitId ? undefined : t('detail.noVisit')}>
            {t('detail.linkVisit')}
          </span>
        )}
      </nav>

      <div className="px-4 pb-4">
        <p role="note" className="flex items-center gap-3 rounded-xl bg-[#EAF3FC] px-4 py-3 text-[14px] text-k-text-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-k-periwinkle">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
          </svg>
          {t('detail.immutable')}
        </p>
      </div>
    </div>
  );
}

/** Una celda de la rejilla: su rótulo en versalitas y el dato debajo. */
function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-white px-5 py-4">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-1.5 break-words text-[16px] font-medium text-k-navy">{children}</dd>
    </div>
  );
}

/** El medio de pago, dibujado. Sólo decora: el nombre va al lado. */
function MethodIcon({ method }: { method: PaymentMethod }) {
  const paths: Record<PaymentMethod, ReactNode> = {
    CASH: (
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="M6 9.5h.01M18 14.5h.01" />
      </>
    ),
    TRANSFER: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
    QR: (
      <>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <path d="M14 14h2v2h-2zM18 18h2M18 14v2" />
      </>
    ),
    CARD: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2" />
        <path d="M2.5 10h19M6 15h4" />
      </>
    ),
    MOBILE_PAYMENT: (
      <>
        <rect x="7" y="2.5" width="10" height="19" rx="2" />
        <path d="M11 18.5h2" />
      </>
    ),
  };
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {paths[method]}
    </svg>
  );
}
