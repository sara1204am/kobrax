import { getTranslations } from 'next-intl/server';
import { memberName, type AccountInfo, type AssignableRole, type MeInfo, type Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader, Badge } from '@/components/panel-ui';
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
 * ponytail: sin caja de búsqueda. El techo es el del plan (pocas filas), así que filtrar no
 * hace falta todavía. **El `q` se construye en W3**, donde `/clients` sí busca del lado del
 * servidor y le da el primer contrato real; ahí se cablea también acá. Escribirlo antes sería
 * adivinar la forma del parámetro — que es exactamente lo que el code-review le marcó al
 * `DataTable` por haber nacido sin consumidor.
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
