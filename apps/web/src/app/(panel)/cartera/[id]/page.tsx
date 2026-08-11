import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ClientDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { ClientCard } from './client-card';

/**
 * La ficha del cliente.
 *
 * Carga **enmascarada**: documento, teléfonos y direcciones vienen tokenizados desde la API, y
 * verlos en claro es un click aparte que queda auditado (`client-card.tsx`).
 */
export default async function ClientePage({ params }: { params: { id: string } }) {
  const t = await getTranslations('portfolio');

  const { status, body } = await apiCall<ClientDetail>(`/clients/${params.id}`, {
    method: 'GET',
    auth: true,
  });

  if (status === 404) notFound();
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('noAccess')} text={body.error?.message} />;
  }

  return <ClientCard client={body.data} />;
}
