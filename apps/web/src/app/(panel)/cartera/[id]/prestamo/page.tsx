import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { AccountInfo, Assignee, ClientDetail } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import { fullName } from '@/lib/format';
import { LoanForm } from './loan-form';

/**
 * Alta de préstamo sobre un cliente.
 *
 * Trae el equipo para elegir a quién se le asigna: en la oficina, quien carga el préstamo y quien
 * lo cobra no son la misma persona (F9 · W3 §5.3). Si el rol no puede ver `/users`, la lista viene
 * vacía y el préstamo queda sin asignar — el server lo acepta.
 */
export default async function PrestamoPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('portfolio');

  const [client, assignees, account] = await Promise.all([
    apiCall<ClientDetail>(`/clients/${params.id}`, { method: 'GET', auth: true }),
    // Sólo con `assignment:write`: sin él, el préstamo queda a cargo de quien lo da de alta (P4).
    apiCall<Assignee[]>('/assignments/assignees', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (client.status === 404) notFound();
  if (client.status !== 200 || !client.body.data) {
    return <EmptyState title={t('noAccess')} text={client.body.error?.message} />;
  }

  return (
    <LoanForm
      clientId={params.id}
      clientName={fullName(client.body.data)}
      assignees={assignees.body.data ?? []}
      currency={account.body.data?.currencyCode ?? 'BOB'}
      defaultArrearsMethod={account.body.data?.arrearsMethod}
    />
  );
}
