import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Permission, type PermissionCatalogEntry, type RoleDetail, type RoleHistoryPage } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getMe, requirePermission } from '@/lib/authz';
import { groupByModule, permissionKey } from '@/lib/roles';
import { workspaceOfMe } from '@/lib/workspace';
import { Badge, EmptyState, PageHeader, Section } from '@/components/panel-ui';
import { NoAccess } from '@/components/no-access';
import { RetryState } from '@/components/retry-state';
import { RiskBadge } from '@/components/roles/risk-badge';
import { HistoryList } from './history-list';
import { RoleActions } from './role-actions';

const TABS = ['permissions', 'people', 'history'] as const;
type Tab = (typeof TABS)[number];

/**
 * Detalle de un rol (vista B del plan de F14 · F7): sus permisos, las personas que lo tienen y su historial. Leer pide `role:read`.
 * Las acciones (editar, restaurar plantilla) las dibuja `RoleActions` sólo con `role:write`.
 */
export default async function RoleDetailPage({ params, searchParams }: { params: { key: string }; searchParams: { tab?: string } }) {
  const blocked = await requirePermission(Permission.ROLE_READ);
  if (blocked) return blocked;
  const t = await getTranslations('roles');
  const tp = await getTranslations('permissions');
  const key = decodeURIComponent(params.key);
  const tab: Tab = (TABS as readonly string[]).includes(searchParams.tab ?? '') ? (searchParams.tab as Tab) : 'permissions';

  const [detail, catalog, history, me] = await Promise.all([
    apiCall<RoleDetail>(`/roles/${encodeURIComponent(key)}`, { method: 'GET', auth: true }),
    apiCall<PermissionCatalogEntry[]>('/roles/permissions', { method: 'GET', auth: true }),
    tab === 'history' ? apiCall<RoleHistoryPage>(`/roles/${encodeURIComponent(key)}/history`, { method: 'GET', auth: true }) : Promise.resolve(null),
    getMe(),
  ]);

  if (detail.status === 404) return <NoAccess text={t('errors.ROLE_NOT_FOUND')} />;
  if (detail.status === 0 || detail.status >= 500 || catalog.status !== 200) return <RetryState title={t('errors.generic')} />;
  if (detail.status !== 200 || !detail.body.data || !catalog.body.data) return <EmptyState title={t('errors.generic')} text={detail.body.error?.message} />;

  const role = detail.body.data;
  const entries = catalog.body.data;
  const timezone = me.body.data?.account?.timezone ?? null;
  const name = t.has(`roleNames.${role.key}`) ? t(`roleNames.${role.key}`) : (role.key ?? role.name);
  const base = `/seguridad/roles/${encodeURIComponent(key)}`;
  const granted = new Set(role.granted);
  // F15 · A-5: con Equipo oculto, los nombres de las personas no son enlaces.
  const teamShown = workspaceOfMe(me.body.data).showsModule('team');

  return (
    <>
      <PageHeader
        title={name}
        subtitle={[role.templateKey ? t('detail.template', { name: t.has(`roleNames.${role.templateKey}`) ? t(`roleNames.${role.templateKey}`) : role.templateKey } ) : null, t('detail.peopleCount', { n: role.members ?? 0 }), role.scopeKind ? t(`scope.${role.scopeKind}`) : null]
          .filter(Boolean)
          .join(' · ')}
        badge={role.diverged ? <Badge tone="warning">{t('state.custom')} ●</Badge> : undefined}
        actions={<RoleActions role={role} catalog={entries} roleName={name} />}
      />

      <p className="mb-4 text-[13px] text-k-text-2">
        {role.templateKey ? t('detail.summary', { granted: role.granted.length, added: role.diff.added.length, removed: role.diff.removed.length }) : t('detail.summaryNoTemplate', { granted: role.granted.length })}
      </p>

      <nav aria-label={t('detail.tabs.label')} className="mb-5 flex gap-1 overflow-x-auto border-b border-k-border">
        {TABS.map((x) => (
          <Link
            key={x}
            href={x === 'permissions' ? base : `${base}?tab=${x}`}
            aria-current={tab === x ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-[14px] font-medium ${tab === x ? 'border-k-periwinkle font-semibold text-k-periwinkle' : 'border-transparent text-k-text-2 hover:text-k-navy'}`}
          >
            {t(`detail.tabs.${x}`)}
          </Link>
        ))}
      </nav>

      {tab === 'permissions' && (
        <div className="space-y-4">
          {groupByModule(entries).map((g) => {
            const on = g.items.filter((p) => granted.has(p.code));
            if (on.length === 0) return null;
            return (
              <Section key={g.module} title={`${t(`modules.${g.module}`)} (${on.length}/${g.items.length})`} inner="space-y-2 p-3">
                <ul className="space-y-1.5">
                  {on.map((p) => (
                    <li key={p.code} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-k-border px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-k-text">{tp(`${permissionKey(p.code)}.name`)}</p>
                        <p className="text-[12px] text-k-text-2">{tp(`${permissionKey(p.code)}.description`)}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {role.diff.added.includes(p.code) && <Badge tone="warning">{t('detail.addedBadge')}</Badge>}
                        <RiskBadge risk={p.risk} />
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            );
          })}
          {role.diff.removed.length > 0 && (
            <Section title={t('detail.removedList')} inner="p-3">
              <ul className="space-y-1.5">
                {role.diff.removed.map((c) => (
                  <li key={c} className="flex items-center justify-between rounded-lg border border-k-border px-3 py-2 text-[14px] text-k-text-2">
                    {tp(`${permissionKey(c)}.name`)}
                    <Badge tone="danger">{t('detail.removedBadge')}</Badge>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}

      {tab === 'people' &&
        (role.people.length === 0 ? (
          <EmptyState title={t('detail.noPeople')} />
        ) : (
          <ul className="space-y-1.5">
            {role.people.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-k-border bg-white px-3 py-2.5">
                <div className="min-w-0">
                  {/* F15 · A-5: con Equipo oculto el nombre no es un enlace (llevaría a una pantalla que no está). */}
                  {teamShown ? (
                    <Link href={`/equipo/${p.userId}`} className="text-[14px] font-medium text-k-navy hover:underline">
                      {p.name}
                    </Link>
                  ) : (
                    <span className="text-[14px] font-medium text-k-navy">{p.name}</span>
                  )}
                  <p className="text-[12px] text-k-text-2">{p.email}</p>
                </div>
                {!p.isActive && <Badge tone="neutral">{t('detail.inactive')}</Badge>}
              </li>
            ))}
          </ul>
        ))}

      {tab === 'history' &&
        (history && history.status === 200 && history.body.data ? (
          <HistoryList roleKey={key} initial={history.body.data} timezone={timezone} />
        ) : (
          <RetryState title={t('errors.generic')} />
        ))}
    </>
  );
}
