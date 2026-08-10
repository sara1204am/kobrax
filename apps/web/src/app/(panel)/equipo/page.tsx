import { getTranslations } from 'next-intl/server';
import { memberName, type AccountInfo, type AssignableRole, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader, Badge } from '@/components/panel-ui';
import { MembersTable } from './members-table';

/**
 * El equipo de la cuenta.
 *
 * ⚠️ `GET /users` **no pagina ni ordena**: devuelve el equipo entero, que por el techo del
 * plan son pocas filas. Por eso el orden se resuelve acá, en memoria, con los mismos
 * `searchParams` que escribe el `DataTable` — la vista sigue siendo compartible por link sin
 * pedirle al servidor algo que no ofrece.
 */
export default async function EquipoPage({
  searchParams,
}: {
  searchParams: { sort?: string; dir?: string };
}) {
  const t = await getTranslations('team');

  const [me, list, roles, account] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AssignableRole[]>('/roles', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (list.status !== 200 || !list.body.data || !me.body.data) {
    return <EmptyState title={t('noAccess')} text={list.body.error?.message} />;
  }

  const members = sortMembers(list.body.data, searchParams.sort, searchParams.dir);
  const seats = account.body.data;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          seats && (
            <Badge tone={seats.memberCount >= seats.maxUsers ? 'warning' : 'neutral'}>
              {t('seats', { used: seats.memberCount, max: seats.maxUsers })}
            </Badge>
          )
        }
      />
      {/* Los roles pueden venir vacíos si el rol de quien mira no tiene `role:read`: en ese
          caso el selector no se dibuja y la lista sigue siendo legible. */}
      <MembersTable
        members={members}
        roles={roles.body.data ?? []}
        meId={me.body.data.userId}
      />
    </>
  );
}

function sortMembers(members: Member[], sort?: string, dir?: string): Member[] {
  if (sort !== 'name' && sort !== 'role') return members;
  const factor = dir === 'desc' ? -1 : 1;
  const key = (m: Member) => (sort === 'role' ? m.roleName : memberName(m));
  return [...members].sort((a, b) => key(a).localeCompare(key(b)) * factor);
}
