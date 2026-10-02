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
import { date, dateTime, money } from '@/lib/format';
import { assignedTo } from '@/lib/cases';
import { isKnownRole } from '@/lib/team';
import { CaseActions } from './case-actions';
import { StatusControl } from './status-control';
import { PriorityCell } from '../priority-cell';

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
  const canWrite = permissions.includes(Permission.CASE_WRITE);

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
            canWrite={canWrite}
            canAssign={permissions.includes(Permission.CASE_ASSIGN)}
            canClose={permissions.includes(Permission.CASE_CLOSE)}
          />
        }
      />

      <div className="space-y-6">
        <Card>
          {/* Estado y prioridad son **controles**, no etiquetas: se tocan y se cambian acá mismo.
              Cada uno lleva su señal —el lápiz, el candado— para que se note que se puede. */}
          <div className="flex flex-wrap items-center gap-2">
            <StatusControl caseId={item.id} status={item.status} canWrite={canWrite} />
            <PriorityCell
              caseId={item.id}
              priority={item.priority}
              pinned={item.priorityPinned}
              canWrite={canWrite}
            />
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
                  {/*
                   * 🔴 La nota de una asignación es **un id**, no una frase: mostrarla cruda le
                   * ponía `bf2e039c-…` en la cara a quien mira la cobranza. Va el nombre, y al lado
                   * el cargo — que es lo que dice si el trabajo quedó en manos de un cobrador o de
                   * una supervisora.
                   */}
                  {activity.type === 'ASSIGNMENT' && assignedTo(activity.notes) ? (
                    <Assignee id={assignedTo(activity.notes)!} members={members} />
                  ) : (
                    activity.notes && <p className="mt-1 text-[14px] text-k-text">{activity.notes}</p>
                  )}
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

/**
 * A quién quedó asignada la cobranza: **nombre y apellido, y el cargo al lado**.
 *
 * El cargo no es decoración: dice si el trabajo quedó en manos de un cobrador de calle o de una
 * supervisora, que es lo que se está mirando cuando se lee quién lo tiene.
 *
 * 🔴 Sin nombre **no se muestra el id**: `/users` da 403 sin `user:read` —el caso de una
 * supervisora— y también puede faltar quien fue dado de baja. Un uuid no le dice nada a nadie.
 */
async function Assignee({ id, members }: { id: string; members: Member[] }) {
  const t = await getTranslations('panel.cases');
  const tRoles = await getTranslations('team.roles');
  const member = members.find((m) => m.userId === id);

  if (!member) return <p className="mt-1 text-[14px] text-k-text-2">{t('unknownAssignee')}</p>;

  return (
    <p className="mt-1 flex flex-wrap items-center gap-2">
      <span className="text-[14px] font-medium text-k-text">{memberName(member)}</span>
      {/* Un rol que el diccionario no conoce se pinta crudo: es preferible al renglón sin cargo. */}
      <Badge tone="neutral">{isKnownRole(member.roleName) ? tRoles(member.roleName) : member.roleName}</Badge>
    </p>
  );
}
