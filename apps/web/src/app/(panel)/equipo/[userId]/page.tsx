import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberName,
  memberStatus,
  Permission,
  type AccountInfo,
  type AssignableRole,
  type MeInfo,
  type Member,
  type CursorPage,
  type MemberActivity,
  type MemberActivityEvent,
  type MemberAuditEvent,
  type MemberConnection,
  type MemberDetail,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Badge, EmptyState } from '@/components/panel-ui';
import { date } from '@/lib/format';
import { isKnownRole } from '@/lib/team';
import { Avatar } from '../team-ui';
import { whenLabel } from '../when';
import { MemberHeaderActions } from './member-header';
import { ActivityTab, AuditTab, ConnectionsTab, InfoTab } from './member-tabs';

const STATUS_TONE = { active: 'success', pending: 'warning', inactive: 'danger' } as const;

type TabKey = 'info' | 'activity' | 'connections' | 'audit';

/**
 * La ficha de un miembro del equipo.
 *
 * La pestaña vive en la URL (`?tab=`) y la lee el servidor: sólo se pide lo que la pestaña muestra, el
 * link se comparte, y «atrás» funciona. Cada pestaña tiene su propio permiso **en la API** —acá sólo se
 * esconde la que va a rechazar—: Conexiones pide `user:write` y Auditoría pide `audit:read`.
 */
export default async function MemberPage({
  params,
  searchParams,
}: {
  params: { userId: string };
  searchParams: { tab?: string; days?: string };
}) {
  const t = await getTranslations('team');
  const tr = await getTranslations('team.roles');
  const tw = await getTranslations('team.lastAccess');
  const locale = await getLocale();
  const id = params.userId;

  const [me, found, list, roles, account] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<MemberDetail>(`/users/${id}`, { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AssignableRole[]>('/roles', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  // Un id que no existe, que no es de esta cuenta o que ni es un UUID: la misma pantalla de «no existe».
  if (found.status === 404 || found.status === 400) notFound();
  const member = found.body.data;
  if (found.status !== 200 || !member || !me.body.data) {
    return <EmptyState title={t('noAccess')} text={found.body.error?.message} />;
  }

  const perms = me.body.data.permissions;
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'info', label: t('detail.tabs.info') },
    { key: 'activity', label: t('detail.tabs.activity') },
    ...(perms.includes(Permission.USER_WRITE) ? [{ key: 'connections' as const, label: t('detail.tabs.connections') }] : []),
    ...(perms.includes(Permission.AUDIT_READ) ? [{ key: 'audit' as const, label: t('detail.tabs.audit') }] : []),
  ];
  const tab: TabKey = tabs.some((x) => x.key === searchParams.tab) ? (searchParams.tab as TabKey) : 'info';

  let body: React.ReactNode;
  if (tab === 'activity') {
    const days = Number(searchParams.days) || 30;
    const [sum, events] = await Promise.all([
      apiCall<MemberActivity>(`/users/${id}/activity?days=${days}`, { method: 'GET', auth: true }),
      apiCall<CursorPage<MemberActivityEvent>>(`/users/${id}/activity/events?days=${days}&limit=30`, { method: 'GET', auth: true }),
    ]);
    body =
      sum.body.data && events.body.data ? (
        <ActivityTab userId={id} activity={sum.body.data} events={events.body.data} />
      ) : (
        <EmptyState title={t('noAccess')} text={(sum.body.error ?? events.body.error)?.message} />
      );
  } else if (tab === 'connections') {
    const res = await apiCall<CursorPage<MemberConnection>>(`/users/${id}/connections?limit=30`, { method: 'GET', auth: true });
    body = res.body.data ? <ConnectionsTab userId={id} connections={res.body.data} /> : <EmptyState title={t('noAccess')} text={res.body.error?.message} />;
  } else if (tab === 'audit') {
    const res = await apiCall<MemberAuditEvent[]>(`/users/${id}/audit`, { method: 'GET', auth: true });
    body = res.body.data ? <AuditTab events={res.body.data} /> : <EmptyState title={t('noAccess')} text={res.body.error?.message} />;
  } else {
    body = <InfoTab member={member} />;
  }

  const status = memberStatus(member);
  const max = account.body.data?.limits.users ?? null;
  const seats = account.body.data ? { used: account.body.data.usage.users, max } : undefined;
  const name = memberName(member);

  return (
    <>
      <nav aria-label={t('detail.breadcrumb')} className="mb-4 flex items-center gap-2 text-[13px] text-k-text-2">
        <Link href="/equipo" className="font-medium text-k-periwinkle hover:underline">
          ← {t('title')}
        </Link>
        <span aria-hidden>/</span>
        <span className="text-k-text">{name}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-5">
          <Avatar member={member} muted={!member.isActive} size="xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="truncate text-[26px] font-semibold tracking-tight text-k-navy">{name}</h1>
              <Badge dot tone={STATUS_TONE[status]}>
                {t(`status.${status}`)}
              </Badge>
            </div>
            <p className="text-[14px] text-k-text-2">{member.email}</p>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-k-text-2">
              <span className="rounded-md bg-k-highlight px-2 py-0.5 font-medium text-k-purple">
                {isKnownRole(member.roleName) ? tr(member.roleName) : member.roleName}
              </span>
              <span>{t('detail.joined', { date: date(member.joinedAt, locale) })}</span>
              {member.lastLoginAt && (
                <span>
                  · {t('detail.lastAccess', { when: whenLabel(member.lastLoginAt, locale, tw) })}
                </span>
              )}
            </p>
          </div>
        </div>
        <MemberHeaderActions
          member={member}
          team={list.body.data ?? []}
          roles={roles.body.data ?? []}
          meId={me.body.data.userId}
          seats={seats}
        />
      </header>

      <nav aria-label={t('detail.sections')} className="mb-5 flex gap-1 overflow-x-auto border-b border-k-border">
        {tabs.map((x) => (
          <Link
            key={x.key}
            href={x.key === 'info' ? `/equipo/${id}` : `/equipo/${id}?tab=${x.key}`}
            aria-current={tab === x.key ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-[14px] font-medium ${
              tab === x.key
                ? 'border-k-periwinkle text-k-navy'
                : 'border-transparent text-k-text-2 hover:text-k-text'
            }`}
          >
            {x.label}
          </Link>
        ))}
      </nav>

      {body}
    </>
  );
}
