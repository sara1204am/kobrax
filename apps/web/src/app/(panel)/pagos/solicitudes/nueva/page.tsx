import { getTranslations } from 'next-intl/server';
import type { CreditDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { isUuid } from '@/lib/payments';
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
  const creditId = searchParams.creditId;

  if (!creditId || !isUuid(creditId)) {
    return <EmptyState title={t('request.title')} text={t('register.noCredit')} />;
  }

  const credit = await apiCall<CreditDetail>(`/credits/${creditId}`, { method: 'GET', auth: true });

  return (
    <>
      <PageHeader title={t('request.title')} subtitle={t('request.text')} />
      <RequestForm creditId={creditId} creditCode={credit.body.data?.code} />
    </>
  );
}
