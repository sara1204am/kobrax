import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  nextPlan,
  planOf,
  usageLevel,
  type AccountInfo,
  type AssignableRole,
  type MeInfo,
  type Member,
} from '@kobrax/shared';
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
 *
 * Esta pantalla **no explica el plan**: eso es Cuenta. Acá sólo se dice cuántos asientos quedan y,
 * cuando no queda ninguno, qué hacer al respecto — que con el FREE en 1 usuario es el estado normal
 * de una cuenta nueva, no un error.
 */
export default async function EquipoPage({ searchParams }: { searchParams: TeamParams }) {
  const t = await getTranslations('team');
  const tPlans = await getTranslations('plans');

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
  // Puede faltar: sin `account:read` la API devuelve 403 y la lista tiene que seguir siendo
  // legible. Sin asientos no hay tope que mostrar ni cartel que dar.
  const seats = account.body.data;
  // `null` = sin tope de miembros. Ningún plan lo tiene hoy, pero una excepción negociada puede:
  // sin número no hay etiqueta que dibujar ni cartel que dar.
  const max = seats?.limits.users ?? null;
  const level = seats ? usageLevel(seats.usage.users, max) : 'ok';
  const plan = seats && planOf(seats.planCode);
  const next = seats && nextPlan(seats.planCode);

  return (
    <>
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        // Los asientos van al lado del título y no en `actions`: no son una acción, son el estado
        // del equipo. Con el botón de invitar —que vive en la barra de la tabla— quedaban a media
        // pantalla del nombre al que califican.
        badge={
          seats && max !== null ? (
            <Badge dot={level !== 'ok'} tone={level === 'ok' ? 'neutral' : 'warning'}>
              {t('seats', { used: seats.usage.users, max })}
            </Badge>
          ) : undefined
        }
      />

      {/* El momento en que el tope importa. Un botón apagado que dice «llegaste al tope» deja al
          administrador sin saber qué hacer; acá se nombra el plan, el número y dónde mirarlo. */}
      {seats && max !== null && level === 'full' && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 rounded-2xl bg-k-warning-bg px-4 py-3">
          <p className="text-[13px] leading-relaxed text-k-warning-text">
            {t('atCapacity.text', {
              plan: plan ? tPlans(`names.${plan.code}`) : seats.planCode,
              max,
            })}{' '}
            {next?.limits.users != null &&
              t('atCapacity.next', {
                plan: tPlans(`names.${next.code}`),
                users: next.limits.users,
              })}
          </p>
          <Link
            href="/cuenta"
            className="shrink-0 text-[13px] font-medium text-k-purple hover:underline"
          >
            {t('atCapacity.link')}
          </Link>
        </div>
      )}

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
        action={<InviteButton roles={roles.body.data ?? []} full={level === 'full'} />}
      />
    </>
  );
}
