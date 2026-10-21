'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, memberStatus, type AssignableRole, type Member } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { usePermissions } from '@/components/permissions';
import { date, time } from '@/lib/format';
import { daysAgo, isKnownRole, memberActions } from '@/lib/team';
import { useMemberDialogs } from './member-dialogs';
import { Avatar, IconAction } from './team-ui';

const TONE = { active: 'success', pending: 'warning', inactive: 'danger' } as const;

export function MembersTable({
  members,
  team,
  meta,
  roles,
  roleNames,
  meId,
  filtered,
  userId,
  action,
  seats,
}: {
  members: Member[];
  /** El equipo completo (sin paginar ni filtrar): de acá se elige a quién pasarle el trabajo. */
  team: Member[];
  meta: PageMeta;
  /** Los asignables (`GET /roles`), que son los que ofrece el selector de la fila. */
  roles: AssignableRole[];
  /** Los que de verdad hay en el equipo, para el filtro. Incluye los que no se pueden asignar. */
  roleNames: string[];
  meId: string;
  /** Hay una búsqueda o un filtro puesto: «no hay nadie» y «nadie coincide» no se arreglan igual. */
  filtered?: boolean;
  userId?: string;
  /** «Invitar a alguien». Va en la barra de la tabla, no en el encabezado. */
  action?: ReactNode;
  /** Asientos del plan, para decir cuántos ocupará reactivar a alguien. Sin permiso de cuenta no viene. */
  seats?: { used: number; max: number | null };
}) {
  const t = useTranslations('team');
  // Los rótulos de rol salen de i18n y no de `ROLE_LABEL` de `shared`, que está en español.
  const tRoles = useTranslations('team.roles');
  const locale = useLocale();
  const { can } = usePermissions();
  const perms = { canWrite: can('user:write'), canInvite: can('user:invite') };
  const { busy, ask, resend, changeRole, dialogs } = useMemberDialogs({ team, seats });

  /** «Hoy, 14:30» · «Ayer, 18:20» · «12 oct 2026». El pendiente no entró nunca: se dice cómo está. */
  function lastAccess(m: Member): ReactNode {
    if (memberStatus(m) === 'pending') return <span className="text-k-warning-text">{t('lastAccess.invited')}</span>;
    if (!m.lastLoginAt) return <span className="text-k-muted">{t('lastAccess.never')}</span>;
    const days = daysAgo(m.lastLoginAt);
    if (days === 0) return t('lastAccess.today', { time: time(m.lastLoginAt, locale) });
    if (days === 1) return t('lastAccess.yesterday', { time: time(m.lastLoginAt, locale) });
    return date(m.lastLoginAt, locale);
  }

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: t('columns.member'),
      sortable: true,
      render: (m) => (
        <span className="flex items-center gap-3">
          <Avatar member={m} muted={!m.isActive} />
          <span className="block min-w-0">
            <span className="flex items-center gap-2">
              <Link
                href={`/equipo/${m.userId}`}
                className={`truncate font-medium hover:text-k-periwinkle hover:underline ${m.isActive ? 'text-k-text' : 'text-k-text-2'}`}
              >
                {memberName(m)}
              </Link>
              {m.userId === meId && (
                <span className="rounded-md bg-k-highlight px-1.5 py-0.5 text-[11px] font-medium text-k-purple">
                  {t('you')}
                </span>
              )}
            </span>
            <span className="block truncate text-[13px] text-k-text-2">{m.email}</span>
          </span>
        </span>
      ),
    },
    {
      key: 'role',
      header: t('columns.role'),
      sortable: true,
      render: (m) => (
        <RoleCell
          member={m}
          roles={roles}
          editable={memberActions(m, meId, perms).changeRole}
          onPick={(roleId) => void changeRole(m, roleId)}
          busy={busy}
        />
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      sortable: true,
      render: (m) => {
        const status = memberStatus(m);
        return (
          <Badge dot tone={TONE[status]}>
            {t(`status.${status}`)}
          </Badge>
        );
      },
    },
    {
      key: 'lastAccess',
      header: t('columns.lastAccess'),
      render: (m) => <span className="text-[13px] text-k-text-2">{lastAccess(m)}</span>,
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      numeric: true,
      render: (m) => {
        const a = memberActions(m, meId, perms);
        const none = !a.deactivate && !a.reactivate && !a.resend && !a.remove;
        if (none) return <span className="text-k-muted">—</span>;
        return (
          <span className="flex justify-end gap-2 whitespace-nowrap">
            {a.resend && (
              <IconAction
                icon={memberStatus(m) === 'pending' ? 'send' : 'mail'}
                label={t('actions.resend')}
                onClick={() => void resend(m)}
                disabled={busy}
              />
            )}
            {a.deactivate && (
              <IconAction
                icon="ban"
                tone="danger"
                label={t('actions.deactivate')}
                onClick={() => ask('deactivate', m)}
              />
            )}
            {a.reactivate && (
              <IconAction
                icon="restore"
                tone="primary"
                label={t('actions.reactivate')}
                onClick={() => ask('reactivate', m)}
              />
            )}
            {a.remove && (
              <IconAction
                icon="trash"
                tone="danger"
                label={t('actions.remove')}
                onClick={() => ask('remove', m)}
              />
            )}
          </span>
        );
      },
    },
  ];

  /**
   * Los filtros del panel. Se aplican **en memoria** (`teamView`), porque `GET /users` no filtra:
   * las claves son igual las de la URL, así que la vista se comparte por link como en las demás.
   */
  const filters: FilterDef[] = [
    {
      keys: ['role'],
      label: t('columns.role'),
      type: 'select',
      allLabel: t('filters.allRoles'),
      options: roleNames.map((name) => ({ value: name, label: isKnownRole(name) ? tRoles(name) : name })),
    },
    {
      keys: ['status'],
      label: t('columns.status'),
      type: 'radio',
      options: (['active', 'pending', 'inactive'] as const).map((s) => ({ value: s, label: t(`status.${s}`) })),
    },
  ];

  return (
    <>
      <DataTable
        tableId="equipo"
        userId={userId}
        columns={columns}
        rows={members}
        rowKey={(m) => m.userId}
        meta={meta}
        filters={filters}
        filtered={filtered}
        entityLabel={t('entity')}
        actions={action}
        search={<SearchBox wide label={t('search.label')} placeholder={t('search.placeholder')} />}
        empty={<EmptyState title={t('empty')} text={t('emptyHint')} />}
        noResults={<EmptyState title={t('noResults')} text={t('noResultsHint')} />}
      />

      {dialogs}
    </>
  );
}

/**
 * El rol: un `<select>` cuando se puede cambiar, y una pastilla apagada cuando no.
 *
 * Los rótulos salen de i18n y no de `ROLE_LABEL` de `shared`, que está en español: el panel
 * se muestra en dos idiomas. La **regla** —qué roles son asignables— sigue siendo del
 * servidor, que es quien arma esta lista.
 */
function RoleCell({
  member,
  roles,
  editable,
  onPick,
  busy,
}: {
  member: Member;
  roles: AssignableRole[];
  editable: boolean;
  onPick: (roleId: string) => void;
  busy: boolean;
}) {
  const t = useTranslations('team.roles');
  const label = (name: string) => (isKnownRole(name) ? t(name) : name);

  if (!editable) {
    return (
      <span className="inline-flex h-10 min-w-[8.5rem] items-center rounded-lg bg-k-bg px-3 text-[14px] text-k-muted">
        {label(member.roleName)}
      </span>
    );
  }

  return (
    <select
      value={member.roleId}
      disabled={busy}
      onChange={(e) => onPick(e.target.value)}
      aria-label={label(member.roleName)}
      className="h-10 min-w-[8.5rem] rounded-lg border border-k-border bg-white px-2.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-60"
    >
      {roles.map((r) => (
        <option key={r.id} value={r.id}>
          {label(r.name)}
        </option>
      ))}
    </select>
  );
}
