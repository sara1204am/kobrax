import { getTranslations } from 'next-intl/server';
import { memberName, type AccountInfo, type AssignableRole, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader, Badge } from '@/components/panel-ui';
import { SearchBox } from '@/components/search-box';
import { matchesText } from '@/lib/portfolio';
import { MembersTable } from './members-table';
import { InviteButton } from './invite-button';

/**
 * El equipo de la cuenta.
 *
 * ⚠️ `GET /users` **no pagina ni ordena**: devuelve el equipo entero, que por el techo del
 * plan son pocas filas. Por eso el orden se resuelve acá, en memoria, con los mismos
 * `searchParams` que escribe el `DataTable` — la vista sigue siendo compartible por link sin
 * pedirle al servidor algo que no ofrece.
 *
 * La caja de búsqueda es la misma que la de la cartera (W3), pero acá **filtra en memoria**: el
 * servidor devuelve el equipo entero y no sabe buscar. Lo que se comparte es el `?q=` en la URL,
 * no el mecanismo — y por eso se escribió recién cuando `/clients` le dio su primer contrato real.
 */
export default async function EquipoPage({
  searchParams,
}: {
  searchParams: { sort?: string; dir?: string; q?: string };
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

  const q = searchParams.q?.trim() ?? '';
  const found = q
    ? list.body.data.filter((m) => matchesText(memberName(m), q) || matchesText(m.email, q))
    : list.body.data;
  const members = sortMembers(found, searchParams.sort, searchParams.dir);
  const seats = account.body.data;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            {seats && (
              <Badge tone={seats.memberCount >= seats.maxUsers ? 'warning' : 'neutral'}>
                {t('seats', { used: seats.memberCount, max: seats.maxUsers })}
              </Badge>
            )}
            <InviteButton
              roles={roles.body.data ?? []}
              full={seats ? seats.memberCount >= seats.maxUsers : false}
            />
          </>
        }
      />
      <SearchBox label={t('search.label')} placeholder={t('search.placeholder')} />
      {/* Los roles pueden venir vacíos si el rol de quien mira no tiene `role:read`: en ese
          caso el selector no se dibuja y la lista sigue siendo legible. */}
      <MembersTable
        members={members}
        roles={roles.body.data ?? []}
        meId={me.body.data.userId}
        filtered={q.length > 0}
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
