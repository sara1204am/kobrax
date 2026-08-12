import { getTranslations } from 'next-intl/server';
import type { AccountInfo, CreditDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { RequestForm } from './request-form';

/**
 * Pedir un cobro: el QR y el link que se le mandan al deudor que no va a recibir a nadie.
 *
 * 🔴 **Sin crédito no se pide nada.** La API acepta una solicitud sin él, pero después
 * `confirm` la rechaza —no sabe contra qué imputar el pago—, así que quedaría un QR que nunca se
 * puede conciliar. Se llega acá desde la ficha del crédito, y sin él la pantalla dice dónde ir.
 */
export default async function NuevaSolicitudPage({
  searchParams,
}: {
  searchParams: { creditId?: string };
}) {
  const t = await getTranslations('panel.payments');

  if (!searchParams.creditId) {
    return <EmptyState title={t('request.title')} text={t('register.noCredit')} />;
  }

  const [credit, account] = await Promise.all([
    apiCall<CreditDetail>(`/credits/${searchParams.creditId}`, { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  return (
    <>
      <PageHeader title={t('request.title')} subtitle={t('request.text')} />
      <RequestForm
        creditId={searchParams.creditId}
        creditCode={credit.body.data?.code}
        currency={credit.body.data?.currency ?? account.body.data?.currencyCode ?? 'BOB'}
      />
    </>
  );
}
