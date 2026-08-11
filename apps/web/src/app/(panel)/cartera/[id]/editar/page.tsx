import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ClientDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { ClientEditor } from '../../client-editor';

/**
 * Edición de cliente.
 *
 * 🔴 **Carga con `reveal=true`, siempre.** Con la PII enmascarada, el formulario mostraría
 * `1234***` y al guardar escribiría esa máscara encima del carnet real. Es exactamente el bug que
 * el comentario de `clients.controller.ts` cuenta que ya ocurrió en el móvil.
 *
 * El revelado queda auditado, y acá **corresponde**: abrir el formulario de edición es pedir los
 * datos completos. La ficha de lectura, en cambio, arranca tapada y los revela con un click.
 */
export default async function EditarClientePage({ params }: { params: { id: string } }) {
  const t = await getTranslations('portfolio');

  const { status, body } = await apiCall<ClientDetail>(`/clients/${params.id}?reveal=true`, {
    method: 'GET',
    auth: true,
  });

  if (status === 404) notFound();
  if (status !== 200 || !body.data) {
    return <EmptyState title={t('noAccess')} text={body.error?.message} />;
  }

  return <ClientEditor client={body.data} />;
}
