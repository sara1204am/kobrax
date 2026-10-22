import { getTranslations } from 'next-intl/server';
import type { Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState } from '@/components/panel-ui';
import type { BranchRow } from '@/lib/branches';
import { BranchesManager } from './branches-manager';

/**
 * Las agencias de la cuenta y quién trabaja en cada una. Leer pide `user:read`; crear, editar y mover gente,
 * `account:write` (la API valida los dos).
 */
export default async function CuentaAgenciasPage() {
  const t = await getTranslations('account');
  const [branches, members] = await Promise.all([
    apiCall<BranchRow[]>('/branches', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
  ]);

  // Un rol sin `user:read` no tiene la pestaña; si llegó por URL se le dice que no.
  if (branches.status !== 200 || !branches.body.data) {
    return <EmptyState title={t('noAccess')} text={branches.body.error?.message} />;
  }
  return <BranchesManager branches={branches.body.data} members={members.body.data ?? []} />;
}
