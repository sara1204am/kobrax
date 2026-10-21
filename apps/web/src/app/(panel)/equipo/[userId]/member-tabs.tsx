import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberStatus,
  type CursorPage,
  type MemberActivity,
  type MemberActivityEvent,
  type MemberAuditEvent,
  type MemberConnection,
  type MemberDetail,
} from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { date, dateTime } from '@/lib/format';
import { isKnownRole } from '@/lib/team';
import { TeamIcon } from '../team-ui';
import { ActivityTable, ConnectionsTable } from './history-tables';
import { whenLabel } from '../when';

const STATUS_TONE = { active: 'success', pending: 'warning', inactive: 'danger' } as const;

/** La caja blanca de cada pestaña: un título y su contenido, sin más. */
function Panel({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-k-border bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5">
        <h2 className="text-[18px] font-semibold text-k-navy">{title}</h2>
        {aside}
      </div>
      <div className="px-6 pb-6 pt-4">{children}</div>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
      {children}
    </th>
  );
}

// ── Información ───────────────────────────────────────────────────────────────

export async function InfoTab({ member }: { member: MemberDetail }) {
  const t = await getTranslations('team');
  const tr = await getTranslations('team.roles');
  const locale = await getLocale();
  const status = memberStatus(member);
  const rows: [string, React.ReactNode][] = [
    [t('detail.firstName'), member.firstName ?? '—'],
    [t('detail.lastName'), member.lastName ?? '—'],
    [t('detail.email'), member.email],
    [t('columns.role'), isKnownRole(member.roleName) ? tr(member.roleName) : member.roleName],
    [t('columns.status'), <Badge key="s" dot tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>],
    [t('detail.joinedAt'), date(member.joinedAt, locale)],
    [t('detail.branch'), member.branchName ?? <span key="b" className="text-k-muted">{t('detail.noBranch')}</span>],
  ];
  return (
    <Panel title={t('detail.dataTitle')}>
      <dl className="grid gap-x-10 gap-y-4 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
            <dd className="mt-1 break-words text-[15px] text-k-text">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 text-[12px] text-k-text-2">{t('detail.readOnly')}</p>
    </Panel>
  );
}

// ── Actividad ─────────────────────────────────────────────────────────────────

const PERIODS = [7, 30, 90] as const;

/** Lo que se mide depende de a qué se dedica el rol: ver `MemberDetailService` en la API. */
const METRICS = {
  field: ['activities', 'payments', 'routes', 'activeDays'],
  admin: ['actions', 'payments', 'logins', 'activeDays'],
} as const;

export async function ActivityTab({
  userId,
  activity,
  events,
}: {
  userId: string;
  activity: MemberActivity;
  events: CursorPage<MemberActivityEvent>;
}) {
  const t = await getTranslations('team.detail');

  return (
    <Panel
      title={t('activityTitle')}
      aside={
        <nav aria-label={t('period')} className="flex gap-1 rounded-xl bg-k-bg p-1">
          {PERIODS.map((d) => (
            <Link
              key={d}
              href={`/equipo/${userId}?tab=activity&days=${d}`}
              aria-current={activity.days === d ? 'true' : undefined}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                activity.days === d ? 'bg-white text-k-navy shadow-sm' : 'text-k-text-2 hover:text-k-text'
              }`}
            >
              {t('lastDays', { days: d })}
            </Link>
          ))}
        </nav>
      }
    >
      <dl
        className={`grid divide-y divide-k-border overflow-hidden rounded-xl border border-k-border sm:divide-x sm:divide-y-0 ${
          METRICS[activity.kind].length === 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'
        }`}
      >
        {METRICS[activity.kind].map((key) => (
          <div key={key} className="px-5 py-4">
            <dd className="text-[26px] font-semibold text-k-navy">{activity.metrics[key] ?? 0}</dd>
            <dt className="text-[13px] text-k-text-2">{t(`metrics.${key}`)}</dt>
          </div>
        ))}
      </dl>

      <h3 className="mb-2 mt-6 text-[15px] font-semibold text-k-text">{t('recent')}</h3>
      {events.items.length === 0 ? (
        <EmptyState title={t('noActivity')} text={t(activity.kind === 'admin' ? 'noActivityAdminHint' : 'noActivityHint')} />
      ) : (
        <ActivityTable userId={userId} days={activity.days} initial={events} />
      )}
    </Panel>
  );
}

// ── Conexiones ────────────────────────────────────────────────────────────────

export async function ConnectionsTab({ userId, connections }: { userId: string; connections: CursorPage<MemberConnection> }) {
  const t = await getTranslations('team.detail');
  return (
    <Panel title={t('connectionsTitle')}>
      {connections.items.length === 0 ? (
        <EmptyState title={t('noConnections')} text={t('noConnectionsHint')} />
      ) : (
        <ConnectionsTable userId={userId} initial={connections} />
      )}
      <p className="mt-4 flex items-start gap-2 text-[12px] text-k-text-2">
        <TeamIcon name="user" className="mt-0.5 h-3.5 w-3.5" />
        {t('connectionsNote')}
      </p>
    </Panel>
  );
}

// ── Auditoría ─────────────────────────────────────────────────────────────────

const AUDIT_EVENTS = [
  'INVITED',
  'INVITATION_RESENT',
  'INVITATION_ACCEPTED',
  'ROLE_CHANGED',
  'DEACTIVATED',
  'REACTIVATED',
  'WORK_REASSIGNED',
];

export async function AuditTab({ events }: { events: MemberAuditEvent[] }) {
  const t = await getTranslations('team.detail');
  const tr = await getTranslations('team.roles');
  const locale = await getLocale();
  const role = (name: string | number | null) =>
    typeof name === 'string' ? (isKnownRole(name) ? tr(name) : name) : '—';

  // Las claves de evento llegan de la API y se validan contra AUDIT_EVENTS: el traductor tipado no las conoce.
  const label = t as unknown as (key: string, values?: Record<string, string | number>) => string;
  const known = events.filter((e) => AUDIT_EVENTS.includes(e.event));

  return (
    <Panel title={t('auditTitle')}>
      {known.length === 0 ? (
        <EmptyState title={t('noAudit')} text={t('noAuditHint')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[14px]">
            <thead className="border-b border-k-border">
              <tr>
                <Th>{t('cols.when')}</Th>
                <Th>{t('cols.event')}</Th>
                <Th>{t('cols.detail')}</Th>
                <Th>{t('cols.by')}</Th>
              </tr>
            </thead>
            <tbody>
              {known.map((e) => (
                <tr key={e.id} className="border-b border-k-border last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-3 text-k-text-2">{dateTime(e.at, locale)}</td>
                  <td className="px-3 py-3 font-medium text-k-text">{label(`audit.${e.event}.title`)}</td>
                  <td className="px-3 py-3 text-k-text-2">
                    {label(`audit.${e.event}.text`, {
                      role: role(e.detail.role ?? null),
                      from: role(e.detail.from ?? null),
                      to: role(e.detail.to ?? null),
                      credits: Number(e.detail.credits ?? 0),
                      agenda: Number(e.detail.agenda ?? 0),
                      routes: Number(e.detail.routes ?? 0),
                    })}
                  </td>
                  <td className="px-3 py-3 text-k-text-2">{e.actorName ?? t('system')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
