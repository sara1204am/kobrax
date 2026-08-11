import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { CreditDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { CreditCard } from './credit-card';

/**
 * La ficha del crédito.
 *
 * Una sola llamada: `GET /credits/:id` **ya trae el cronograma** (`installments`), así que pedirle
 * además `/schedule` sería preguntar dos veces lo mismo — ese endpoint devuelve un recorte de esta
 * misma respuesta.
 */
export default async function CreditoPage({ params }: { params: { id: string; cid: string } }) {
  const t = await getTranslations('portfolio');

  const { status, body } = await apiCall<CreditDetail>(`/credits/${params.cid}`, {
    method: 'GET',
    auth: true,
  });

  if (status === 404) notFound();
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('noAccess')} text={body.error?.message} />;
  }

  return <CreditCard credit={body.data} clientId={params.id} />;
}
