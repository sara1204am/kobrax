import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { AccountInfo, ClientDetail, Member } from '@kobrax/shared';
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

  const [client, team, account] = await Promise.all([
    apiCall<ClientDetail>(`/clients/${params.id}`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
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
      team={(team.body.data ?? []).filter((m) => m.isActive)}
      currency={account.body.data?.currencyCode ?? 'BOB'}
    />
  );
}
