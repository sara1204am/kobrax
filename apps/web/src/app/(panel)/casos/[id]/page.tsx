import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberName,
  Permission,
  type AccountInfo,
  type CaseDetail,
  type MeInfo,
  type Member,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Badge, Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { PRIORITY_TONE, STATUS_TONE } from '@/lib/cases';
import { date, dateTime, money } from '@/lib/format';
import { CaseActions } from './case-actions';

/**
 * La ficha del caso: de quién es, en qué estado está y qué se hizo.
 *
 * El historial viene **en la misma llamada** (`activities`, ya ordenadas desc por la API), así que
 * el timeline no pide nada aparte. Se pinta en el servidor: no tiene ni una interacción, y así no
 * viaja como JavaScript al navegador.
 */
export default async function CasoPage({ params }: { params: { id: string } }) {
  const t = await getTranslations('panel.cases');
  const locale = await getLocale();

  const [detail, me, team, account] = await Promise.all([
    apiCall<CaseDetail>(`/cases/${params.id}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('title')} text={detail.body.error?.message} />;
  }

  const item = detail.body.data;
  const members = team.body.data ?? [];
  const permissions = me.body.data?.permissions ?? [];
  const currency = item.currency ?? account.body.data?.currencyCode ?? 'BOB';
  const assignee = members.find((m) => m.userId === item.assigneeId);

  return (
    <>
      <PageHeader
        title={item.clientName ?? t('title')}
        subtitle={t('subtitle')}
        actions={
          <CaseActions
            caseId={item.id}
            status={item.status}
            members={members}
            canWrite={permissions.includes(Permission.CASE_WRITE)}
            canAssign={permissions.includes(Permission.CASE_ASSIGN)}
            canClose={permissions.includes(Permission.CASE_CLOSE)}
          />
        }
      />

      <div className="space-y-6">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[item.status]}>{t(`status.${item.status}`)}</Badge>
            <Badge tone={PRIORITY_TONE[item.priority]}>{t(`priority.${item.priority}`)}</Badge>
            {item.isOverdue && <Badge tone="danger">{t('overdueBadge')}</Badge>}
          </div>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('detail.balance')} value={money(item.amount, currency)} />
            <Fact label={t('columns.daysPastDue')} value={item.daysPastDue ? t('days', { n: item.daysPastDue }) : '—'} />
            <Fact label={t('detail.installment')} value={money(item.installmentAmount, currency)} />
            <Fact label={t('detail.nextDueDate')} value={date(item.nextDueDate, locale)} />
            <Fact label={t('detail.sla')} value={date(item.slaDueAt, locale)} />
            {/* Sin nombre no es sin cobrador: `/users` da 403 sin `user:read`. */}
            <Fact
              label={t('detail.assignee')}
              value={
                assignee ? memberName(assignee) : item.assigneeId ? t('unknownAssignee') : t('noAssignee')
              }
            />
          </dl>

          <Link
            href={`/cartera/${item.clientId}`}
            className="mt-5 inline-block text-[14px] font-medium text-k-purple hover:underline"
          >
            {t('detail.openClient')}
          </Link>
        </Card>

        <section>
          <h2 className="mb-3 text-[18px] font-semibold text-k-navy">{t('detail.timeline')}</h2>
          {item.activities?.length ? (
            <ol className="space-y-3">
              {item.activities.map((activity) => (
                <li key={activity.id} className="rounded-2xl border border-k-border bg-white px-5 py-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[14px] font-medium text-k-text">
                      {/* Un tipo que el diccionario no conoce se muestra crudo: la API puede sumar
                          uno nuevo, y esconderlo dejaría un renglón sin decir qué pasó. */}
                      {t.has(`activityType.${activity.type}`) ? t(`activityType.${activity.type}`) : activity.type}
                    </span>
                    <span className="text-[13px] text-k-text-2">{dateTime(activity.createdAt, locale)}</span>
                  </div>
                  {activity.result && <p className="mt-1 text-[13px] text-k-text-2">{activity.result}</p>}
                  {activity.notes && <p className="mt-1 text-[14px] text-k-text">{activity.notes}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title={t('detail.timelineEmpty')} />
          )}
        </section>
      </div>
    </>
  );
}
