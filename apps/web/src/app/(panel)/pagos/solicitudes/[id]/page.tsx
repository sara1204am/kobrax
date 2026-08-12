import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { AccountInfo, CreditDetail, PaymentRequestItem } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { isUuid } from '@/lib/payments';
import { RequestView } from './request-view';

/**
 * Un cobro pedido: el QR, el link y —si la persona puede— el botón de confirmar que entró.
 *
 * Existe porque el cobro **no se resuelve en el mismo rato en que se pide**: se le manda el link al
 * deudor y la plata aparece horas o días después. Y porque quien confirma casi nunca es quien pidió
 * — `payment:approve` lo tiene el MANAGER, que no tiene `payment:write`.
 */
export default async function SolicitudPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('panel.payments');
  if (!isUuid(params.id)) notFound();

  const [detail, account] = await Promise.all([
    apiCall<PaymentRequestItem>(`/payment-requests/${params.id}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('request.title')} text={detail.body.error?.message} />;
  }
  const request = detail.body.data;

  const credit = request.creditId
    ? (await apiCall<CreditDetail>(`/credits/${request.creditId}`, { method: 'GET', auth: true })).body.data
    : null;

  return (
    <>
      <PageHeader title={t('request.title')} subtitle={t('request.text')} />
      <RequestView
        request={request}
        creditLabel={credit?.code ?? request.creditId ?? '—'}
        currency={credit?.currency ?? account.body.data?.currencyCode ?? 'BOB'}
      />
    </>
  );
}
