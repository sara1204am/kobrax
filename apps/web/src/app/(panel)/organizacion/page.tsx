import { getTranslations } from 'next-intl/server';
import type { AccountInfo, Member } from '@kobrax/shared';
import { requirePermission } from '@/lib/authz';
import { apiCall } from '@/lib/bff';
import { Permission } from '@kobrax/shared';
import { EmptyState, PageHeader } from '@/components/panel-ui';
import { isMultiOffice, officePlan, type OfficeRow, type OfficeType } from '@/lib/offices';
import { OfficesView } from './offices-view';
import { SingleOffice } from './single-office';

/**
 * Las oficinas de la cuenta y quién trabaja en cada una. Leer pide `office:read`; crear, mover, desactivar y asignar,
 * `office:write` (la API valida los dos y limita el árbol al alcance de cada persona).
 *
 * 🔴 **Una sola oficina no ve jerarquía** (RULES C2): sin árbol, sin buscador, sin selectores. Queda su ficha y, si puede
 * y el plan lo permite, el aviso para abrir la primera agencia.
 */
export default async function CuentaOficinasPage() {
  const blocked = await requirePermission(Permission.OFFICE_READ);
  if (blocked) return blocked;
  const t = await getTranslations('account');
  const tp = await getTranslations('panel.pages.organization');
  const [branches, members, types, account] = await Promise.all([
    apiCall<OfficeRow[]>('/branches', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<OfficeType[]>('/branch-types', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  // Un rol sin `office:read` no tiene la pestaña; si llegó por URL se le dice que no.
  if (branches.status !== 200 || !branches.body.data) {
    return <EmptyState title={t('noAccess')} text={branches.body.error?.message} />;
  }
  const rows = branches.body.data;
  const props = {
    rows,
    types: types.body.data ?? [],
    members: members.body.data ?? [],
    plan: officePlan(account.body.data, rows),
  };
  return (
    <>
      <PageHeader title={tp('title')} subtitle={tp('subtitle')} />
      {isMultiOffice(rows) ? <OfficesView {...props} /> : <SingleOffice {...props} />}
    </>
  );
}
