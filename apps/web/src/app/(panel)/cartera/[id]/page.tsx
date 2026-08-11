import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ClientDetail, CreditDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { ClientCard } from './client-card';
import { CreditsSection } from './credits-section';

/**
 * La ficha del cliente, con sus créditos adentro.
 *
 * Carga **enmascarada**: documento, teléfonos y direcciones vienen tokenizados desde la API, y
 * verlos en claro es un click aparte que queda auditado (`client-card.tsx`).
 */
export default async function ClientePage({ params }: { params: { id: string } }) {
  const t = await getTranslations('portfolio');

  const [client, credits] = await Promise.all([
    apiCall<ClientDetail>(`/clients/${params.id}`, { method: 'GET', auth: true }),
    apiCall<CreditDetail[]>(`/credits?clientId=${params.id}&limit=100`, { method: 'GET', auth: true }),
  ]);

  if (client.status === 404) notFound();
  if (client.status !== 200 || !client.body.data) {
    return <EmptyState title={t('noAccess')} text={client.body.error?.message} />;
  }

  return (
    <ClientCard
      client={client.body.data}
      credits={
        // Los créditos van dentro de la ficha (D2): la cartera es por cliente. Si `credit:read`
        // no está, la lista viene vacía y la sección lo dice en vez de mentir con un cero.
        <CreditsSection
          clientId={params.id}
          credits={credits.body.data ?? []}
          denied={credits.status === 403}
        />
      }
    />
  );
}
