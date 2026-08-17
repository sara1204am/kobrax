import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { CatalogType, type CreditDetail, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { isUuid } from '@/lib/uuid';
import { CreditCard } from './credit-card';

/**
 * La ficha del crédito.
 *
 * `GET /credits/:id` **ya trae el cronograma** (`installments`), así que pedirle además `/schedule`
 * sería preguntar dos veces lo mismo — ese endpoint devuelve un recorte de esta misma respuesta.
 *
 * 🔴 **Ni el equipo ni el catálogo pueden tumbar la pantalla.** Un rol sin `user:read` recibe 403 en
 * `/users`, y mirar un préstamo no puede depender de eso: se cae a lista vacía y el selector de
 * responsable directamente no se dibuja.
 */
export default async function CreditoPage({ params }: { params: { id: string; cid: string } }) {
  const t = await getTranslations('portfolio');
  if (!isUuid(params.cid)) notFound();

  const [credit, team, types] = await Promise.all([
    apiCall<CreditDetail>(`/credits/${params.cid}`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.CREDIT_TYPE}`, { method: 'GET', auth: true }),
  ]);

  if (credit.status === 404) notFound();
  if (credit.status !== 200 || !credit.body.data) {
    return <EmptyState title={t('noAccess')} text={credit.body.error?.message} />;
  }

  return (
    <CreditCard
      credit={credit.body.data}
      clientId={params.id}
      team={team.body.data ?? []}
      types={types.body.data ?? []}
    />
  );
}
