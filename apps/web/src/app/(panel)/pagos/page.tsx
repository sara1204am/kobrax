import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { AccountInfo, CreditDetail, MeInfo, Member, PaymentItem } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import {
  defaultPeriod,
  hasPaymentFilters,
  isUuid,
  paymentLimit,
  paymentQuery,
  totalOf,
  type PaymentParams,
} from '@/lib/payments';
import { Badge, EmptyState, PageHeader } from '@/components/panel-ui';
import { money } from '@/lib/format';
import { PAYMENT_REQUESTS_ENABLED } from '@/lib/features';
import { PaymentActions } from './payment-actions';
import { PaymentsTable } from './payments-table';

/**
 * El ledger del período.
 *
 * `GET /payments` devuelve los de **todo el tenant**, no los de un cobrador — la lección que dejó
 * Rutas. `registeredBy` dice quién lo cargó, y **no hay parámetro para filtrar por persona**.
 *
 * El total es el de **todo el filtro** (período, fuente, cobrador), no el de la página: lo suma la API
 * con el mismo `where` que la lista (`meta.aggregates.totalAmount`). El rótulo dice cuántos pagos cuenta.
 * Si el servidor no lo trae, cae al de la página.
 */
export default async function PagosPage({ searchParams }: { searchParams: PaymentParams }) {
  const t = await getTranslations('panel.payments');

  const [list, team, account, me] = await Promise.all([
    apiCall<PaymentItem[]>(`/payments?${paymentQuery(searchParams)}`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('title')} text={list.body.error?.message} />;
  }

  const rows = list.body.data;
  const currency = account.body.data?.currencyCode ?? 'BOB';
  const pagination = pageMeta(list.body, searchParams.page, paymentLimit(searchParams));
  // El total y la cuenta son los de TODO el filtro (los suma la API). Si el servidor no los trae, el de la página.
  const periodTotal = list.body.meta.aggregates?.totalAmount ?? totalOf(rows);

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
            {rows.length > 0 && (
              <Badge tone="neutral">{t('total', { n: pagination.total, amount: money(periodTotal, currency) })}</Badge>
            )}
          </div>
        }
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
        members={team.body.data ?? []}
        currency={currency}
        filtered={hasPaymentFilters(searchParams)}
        userId={me.body.data?.userId}
        period={defaultPeriod()}
        action={<PaymentActions credit={credit} />}
      />
    </>
  );
}
