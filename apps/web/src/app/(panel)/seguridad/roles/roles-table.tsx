'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { RoleSummary } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column } from '@/components/data-table';
import { usePermissions } from '@/components/permissions';
import { dateTime } from '@/lib/format';

/** Los roles de la cuenta (vista A). Una fila por rol; el nombre lleva al detalle. */
export function RolesTable({ roles, timezone, userId }: { roles: RoleSummary[]; timezone: string | null; userId?: string }) {
  const t = useTranslations('roles');
  const locale = useLocale();
  const { can } = usePermissions();

  const label = (r: RoleSummary) => (t.has(`roleNames.${r.key}`) ? t(`roleNames.${r.key}`) : (r.key ?? r.name));

  const columns: Column<RoleSummary>[] = [
    {
      key: 'role',
      header: t('columns.role'),
      render: (r) => (
        <Link href={`/seguridad/roles/${encodeURIComponent(r.key ?? r.name)}`} className="font-medium text-k-navy hover:underline">
          {label(r)}
          {r.diverged && (
            <span title={t('diverged')} aria-label={t('diverged')} className="ml-1.5 text-k-warning">
              ●
            </span>
          )}
        </Link>
      ),
    },
    { key: 'origin', header: t('columns.origin'), render: (r) => <Badge tone="neutral">{t(`origin.${r.source ?? 'TEMPLATE'}`)}</Badge> },
    { key: 'people', header: t('columns.people'), numeric: true, render: (r) => r.members ?? 0 },
    { key: 'scope', header: t('columns.scope'), render: (r) => (r.scopeKind ? t(`scope.${r.scopeKind}`) : '—') },
    { key: 'permissions', header: t('columns.permissions'), numeric: true, render: (r) => `${r.permissions ?? 0}/${r.permissionsTotal ?? 0}` },
    { key: 'modified', header: t('columns.modified'), render: (r) => (r.diverged ? dateTime(r.updatedAt, locale, timezone ?? undefined) : t('unmodified')) },
    {
      key: 'state',
      header: t('columns.state'),
      render: (r) => <Badge tone={r.editable === false ? 'neutral' : r.diverged ? 'warning' : 'success'}>{r.editable === false ? t('state.locked') : r.diverged ? t('state.custom') : t('state.system')}</Badge>,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={roles}
      rowKey={(r) => r.key ?? r.name}
      meta={{ total: roles.length, page: 1, limit: Math.max(roles.length, 1), pages: 1 }}
      empty={<EmptyState title={t('empty')} />}
      tableId="roles"
      userId={userId}
      entityLabel={t('title').toLowerCase()}
      actions={
        can('role:read') ? (
          <Link href="/seguridad/roles/comparar" className="flex h-10 items-center rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-text-2 hover:bg-k-bg">
            {t('compare')}
          </Link>
        ) : undefined
      }
    />
  );
}
