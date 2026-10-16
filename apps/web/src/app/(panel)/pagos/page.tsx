import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AccountInfo, CreditDetail, MeInfo, PaymentItem } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import {
  defaultPeriod,
  effectivePeriod,
  hasPaymentFilters,
  isUuid,
  paymentLimit,
  paymentQuery,
  totalOf,
  type PaymentParams,
} from '@/lib/payments';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { PAYMENT_REQUESTS_ENABLED } from '@/lib/features';
import { loadOfficers } from './officers';
import { PaymentActions } from './payment-actions';
import { PaymentSummary } from './payment-summary';
import { PaymentsTable } from './payments-table';

/**
 * El ledger del período.
 *
 * `GET /payments` devuelve los de **todo el tenant**, no los de un cobrador — la lección que dejó
 * Rutas. `registeredBy` dice quién lo cargó, y **no hay parámetro para filtrar por persona**.
 *
 * Las tarjetas de arriba son de **todo el filtro**, no de la página: las suma la API con el mismo `where` que la lista
 * (`meta.aggregates`). «Hoy» y «este mes» ignoran el rango de fechas y respetan el resto (ver `PaymentSummary`).
 *
 * ⚠️ El alcance de lo que se ve lo pone la API, no esta pantalla. Aquí sólo se decide qué filtros se ofrecen: el de
 * oficial se dibuja si quien mira tiene a quién consultar (`loadOfficers`), y un cobrador no lo tiene.
 */
export default async function PagosPage({ searchParams }: { searchParams: PaymentParams }) {
  const t = await getTranslations('panel.payments');

  const [list, account, me] = await Promise.all([
    apiCall<PaymentItem[]>(`/payments?${paymentQuery(searchParams)}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  const rows = list.body.data;
  const currency = account.body.data?.currencyCode ?? 'BOB';
  const pagination = pageMeta(list.body, searchParams.page, paymentLimit(searchParams));
  const aggregates = list.body.meta.aggregates;
  // Los permisos salen de la sesión: según ellos se decide a quién se puede consultar.
  const officers = await loadOfficers(me.body.data?.permissions ?? []);

  /*
   * El crédito sólo se pide cuando se está mirando uno: es lo que hace posible registrar un pago o
   * pedir un cobro desde acá —las dos acciones lo exigen— y de paso lo nombra por su código en vez
   * de por un uuid. Si no se puede leer, la acción sigue funcionando con el id.
   */
  const creditId = searchParams.creditId && isUuid(searchParams.creditId) ? searchParams.creditId : undefined;
  const detail = creditId ? (await apiCall<CreditDetail>(`/credits/${creditId}`, { method: 'GET', auth: true })).body.data : undefined;
  const credit = creditId
    ? {
        id: creditId,
        code: detail?.code,
        suggestedAmount: detail?.suggestedPaymentAmount,
        external: detail?.locked,
        balance: detail?.outstandingBalance,
        currency: detail?.currency,
      }
    : undefined;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            {/* Quien confirma no es quien pidió el cobro: la bandeja es su entrada. */}
            {PAYMENT_REQUESTS_ENABLED && (
              <Link href="/pagos/solicitudes" className="text-[14px] font-medium text-k-purple hover:underline">
                {t('requests.queue')}
              </Link>
            )}
          </div>
        }
      />

      <PaymentSummary
        totals={{
          today: aggregates?.todayAmount,
          month: aggregates?.monthAmount,
          // Sin el total del servidor (versión vieja) cae al de la página, no a un cero.
          period: aggregates?.totalAmount ?? (rows.length > 0 ? totalOf(rows) : 0),
          count: pagination.total,
        }}
        currency={currency}
        period={effectivePeriod(searchParams)}
      />

      {/* Filtrado por un crédito la lista parece vacía sin serlo: la salida tiene que estar a la
          vista, o se lee como «no hay pagos». */}
      {credit && (
        <Link href="/pagos" className="mb-4 block text-[14px] font-medium text-k-purple hover:underline">
          {t('allPayments')}
        </Link>
      )}

      <PaymentsTable
        rows={rows}
        meta={pagination}
        officers={officers}
        currency={currency}
        filtered={hasPaymentFilters(searchParams)}
        userId={me.body.data?.userId}
        period={defaultPeriod()}
        action={<PaymentActions credit={credit} />}
      />
    </>
  );
}
