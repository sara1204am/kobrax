import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { PAYMENT_REQUESTS_ENABLED } from '@/lib/features';
import type { AccountInfo, MeInfo, PaymentRequestItem } from '@kobrax/shared';
import { apiCall, pageMeta } from '@/lib/bff';
import { paymentLimit, requestQuery, requestStatus, type RequestParams } from '@/lib/payments';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RequestsTable } from './requests-table';

/**
 * Los cobros pedidos. Abre en lo que falta confirmar.
 *
 * Quien confirma (`payment:approve`) casi nunca es quien pidió el cobro, así que necesita ver la
 * lista: antes `/pagos/solicitudes` redirigía al ledger porque la API sólo leía una por id.
 */
export default async function SolicitudesPage({ searchParams }: { searchParams: RequestParams }) {
  if (!PAYMENT_REQUESTS_ENABLED) notFound(); // apagado en la primera versión: ver `lib/features.ts`
  const t = await getTranslations('panel.payments');

  const [list, account, me] = await Promise.all([
    apiCall<PaymentRequestItem[]>(`/payment-requests?${requestQuery(searchParams)}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data) {
    return <EmptyState title={t('requests.title')} text={list.body.error?.message} />;
  }

  return (
    <>
      <PageHeader title={t('requests.listTitle')} subtitle={t('requests.listSubtitle')} />
      <Link href="/pagos" className="mb-4 block text-[14px] font-medium text-k-purple hover:underline">
        {t('allPayments')}
      </Link>
      <RequestsTable
        rows={list.body.data}
        meta={pageMeta(list.body, searchParams.page, paymentLimit(searchParams))}
        currency={account.body.data?.currencyCode ?? 'BOB'}
        status={requestStatus(searchParams)}
        userId={me.body.data?.userId}
      />
    </>
  );
}
