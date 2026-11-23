import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Permission, type CreditPaymentsView } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { requirePermission } from '@/lib/authz';
import { isUuid } from '@/lib/uuid';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { CreditSync } from '@/components/credit-sync';
import { CreditPaymentHistory } from './credit-payment-history';

/**
 * Los pagos de UN crédito, sin salir de su contexto: el historial con la imputación de cada pago a sus cuotas.
 *
 * Es otra pantalla que el ledger general (`/pagos`), que sigue igual para mirar el período de toda la cartera. Acá no hay período: es
 * el historial completo del crédito. El alcance y los permisos los pone la API (`payment:read`, y el crédito tiene que estar en el
 * alcance de quien mira: si no, 404 como si no existiera).
 */
export default async function CreditoPagosPage({ params }: { params: { id: string; cid: string } }) {
  if (!isUuid(params.cid) || !isUuid(params.id)) notFound();
  const blocked = await requirePermission(Permission.PAYMENT_READ);
  if (blocked) return blocked;
  const t = await getTranslations('portfolio.creditPaymentsPage');

  const res = await apiCall<CreditPaymentsView>(`/credits/${params.cid}/payments`, { method: 'GET', auth: true });
  if (res.status === 404) notFound();
  if (res.status !== 200 || !res.body.data) return <EmptyState title={t('title')} text={res.body.error?.message ?? t('noAccess')} />;

  const view = res.body.data;
  // El cliente de la URL tiene que ser el del crédito: con otro, el regreso llevaría a una persona ajena.
  if (view.clientId !== params.id) redirect(`/cartera/${view.clientId}/credito/${params.cid}/pagos`);

  const back = `/cartera/${view.clientId}/credito/${view.creditId}`;
  return (
    <>
      <CreditSync creditId={view.creditId} />
      <PageHeader
        title={view.code ? `${t('title')} · ${view.code}` : t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link href={back} className="text-k-base font-medium text-k-purple hover:underline">
            {t('backToCredit')}
          </Link>
        }
      />
      <CreditPaymentHistory view={view} />
    </>
  );
}
