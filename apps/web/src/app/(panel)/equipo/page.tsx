import { getTranslations } from 'next-intl/server';
import type { AccountInfo, AssignableRole, MeInfo, Member } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { EmptyState, PageHeader, Badge } from '@/components/panel-ui';
import { hasTeamFilters, teamView, type TeamParams } from '@/lib/team';
import { MembersTable } from './members-table';
import { InviteButton } from './invite-button';

/**
 * El equipo de la cuenta.
 *
 * ⚠️ `GET /users` **no pagina, no ordena y no busca**: devuelve el equipo entero, que por el techo
 * del plan son pocas filas. Por eso la vista se arma acá con `teamView`, en memoria, a partir de los
 * mismos `searchParams` que escribe el `DataTable` — la vista sigue siendo compartible por link sin
 * pedirle al servidor algo que no ofrece.
 */
export default async function EquipoPage({ searchParams }: { searchParams: TeamParams }) {
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

  const { rows, meta } = teamView(list.body.data, searchParams);
  const seats = account.body.data;

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          seats ? (
            <Badge tone={seats.memberCount >= seats.maxUsers ? 'warning' : 'neutral'}>
              {t('seats', { used: seats.memberCount, max: seats.maxUsers })}
            </Badge>
          ) : undefined
        }
      />
      {/* Los roles pueden venir vacíos si el rol de quien mira no tiene `role:read`: en ese
          caso el selector no se dibuja y la lista sigue siendo legible. */}
      <MembersTable
        members={rows}
        meta={meta}
        // Los roles del filtro salen de QUIÉN HAY, no de `/roles`: ése devuelve sólo los tres
        // asignables, y filtrar por «Gerente» tiene que ser posible aunque no se pueda asignar.
        roleNames={[...new Set(list.body.data.map((m) => m.roleName))].sort()}
        roles={roles.body.data ?? []}
        meId={me.body.data.userId}
        filtered={hasTeamFilters(searchParams)}
        action={
          <InviteButton
            roles={roles.body.data ?? []}
            full={seats ? seats.memberCount >= seats.maxUsers : false}
          />
        }
      />
    </>
  );
}
