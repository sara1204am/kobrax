import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberName,
  Permission,
  type AccountInfo,
  type MeInfo,
  type Member,
  type MoraCaseLookup,
  type ClientDetail,
  type CreditNote,
  type MoraCreditDetail,
  type MoraEpisode,
  type MoraPromise,
  type PaymentItem,
  type RecoveryMetrics,
  CatalogType,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { Badge, Card, EmptyState, Fact, PageHeader } from '@/components/panel-ui';
import { SourceBadge } from '@/components/source-badge';
import { date, dateTime, dayDate, money } from '@/lib/format';
import { assignedTo } from '@/lib/cases';
import { isKnownRole } from '@/lib/team';
import { PaymentActions } from '../../pagos/payment-actions';
import { ActivityResult } from './activity-result';
import { RegisterActivityButton } from './activity-form';
import { ArrearsHistory } from './arrears-history';
import { CaseActions } from './case-actions';
import { NotesSection } from './notes-section';
import { OpenCaseButton } from './open-case-button';
import { PaymentsSection } from './payments-section';
import { PersonSections } from './person-sections';
import { PromisesSection } from './promises-section';
import { RecoveryMetricsSection } from './recovery-metrics';
import { StatusControl } from './status-control';
import { PriorityCell } from '../priority-cell';

/**
 * La ficha de recuperación **de un crédito**: de quién es, cuánto debe, quién lo trabaja y qué se hizo.
 *
 * 🔴 **La ruta es el crédito, no el caso.** Antes `/mora/<id>` abría un caso, y un crédito en mora sin caso
 * no tenía ficha. Los enlaces viejos (`/mora/<caseId>`, de notificaciones o de la bitácora del cliente)
 * siguen abriendo: si el id no es un crédito, se busca a qué crédito pertenece ese caso y se redirige.
 *
 * El historial viene **en la misma llamada** (`activities`, ya ordenadas desc por la API) y se pinta en el
 * servidor: no tiene ni una interacción, y así no viaja como JavaScript al navegador.
 */
export default async function CreditoMoraPage({ params }: { params: { creditId: string } }) {
  const t = await getTranslations('panel.cases');
  const locale = await getLocale();

  const [detail, episodes, metrics, promises, notes, payments, methods, banks, me, team, account] = await Promise.all([
    apiCall<MoraCreditDetail>(`/mora/${params.creditId}`, { method: 'GET', auth: true }),
    apiCall<MoraEpisode[]>(`/mora/${params.creditId}/episodes`, { method: 'GET', auth: true }),
    apiCall<RecoveryMetrics>(`/mora/${params.creditId}/metrics`, { method: 'GET', auth: true }),
    apiCall<MoraPromise[]>(`/mora/${params.creditId}/promises`, { method: 'GET', auth: true }),
    apiCall<CreditNote[]>(`/mora/${params.creditId}/notes`, { method: 'GET', auth: true }),
    apiCall<PaymentItem[]>(`/payments?creditId=${params.creditId}&limit=50`, { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.PAYMENT_METHOD}`, { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.BANK}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (detail.status === 404) {
    // ¿Será el id de un caso de un enlace viejo? Si lo es, se abre su crédito.
    const legacy = await apiCall<MoraCaseLookup>(`/mora/by-case/${params.creditId}`, { method: 'GET', auth: true });
    if (legacy.status === 200 && legacy.body.data) redirect(`/mora/${legacy.body.data.creditId}`);
    notFound();
  }
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('title')} text={detail.body.error?.message} />;
  }

  const item = detail.body.data;
  // Dependen del `clientId` que trae la ficha, así que van después. Un 403 (sin `client:read`) no tumba la página.
  const [client, collateralTypes] = await Promise.all([
    apiCall<ClientDetail>(`/clients/${item.clientId}`, { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.COLLATERAL_TYPE}`, { method: 'GET', auth: true }),
  ]);
  const members = team.body.data ?? [];
  const permissions = me.body.data?.permissions ?? [];
  const currency = item.currency ?? account.body.data?.currencyCode ?? 'BOB';
  const canWrite = permissions.includes(Permission.CASE_WRITE);
  const open = item.case;
  const assignee = members.find((m) => m.userId === open?.assigneeId);
  /** Un dato que puede faltar: «—», nunca 0 (un importado puede no traerlo). */
  const amount = (n: number | undefined) => (n === undefined ? '—' : money(n, currency));
  /** Un día civil (`YYYY-MM-DD`: próxima fecha, último pago, inicio de mora): en UTC, o Bolivia lo corre un día. */
  const day = (iso: string | undefined) => (iso ? dayDate(iso, locale) : '—');
  /** Un instante (el plazo de gestión del caso): sí va en hora local. */
  const instant = (iso: string | undefined) => (iso ? date(iso, locale) : '—');

  return (
    <>
      <PageHeader
        title={item.clientName ?? t('title')}
        subtitle={item.code ? t('detail.creditCode', { code: item.code }) : t('subtitle')}
        actions={
          <>
            {/* Registrar una gestión sirve con o sin caso: si no hay uno, la API lo abre. */}
            {canWrite && (
              <RegisterActivityButton
                creditId={item.creditId}
                suggestedAmount={item.suggestedPaymentAmount}
                methods={methods.body.data ?? []}
                banks={banks.body.data ?? []}
              />
            )}
            {/* Registrar un pago es de quien puede cobrar (`payment:write`); el componente se oculta solo sin el permiso. */}
            <PaymentActions
              credit={{ id: item.creditId, code: item.code, suggestedAmount: item.suggestedPaymentAmount, external: !!item.externalSource }}
            />
          {open ? (
            <CaseActions
              caseId={open.id}
              status={open.status}
              members={members}
              canAssign={permissions.includes(Permission.CASE_ASSIGN)}
              canClose={permissions.includes(Permission.CASE_CLOSE)}
            />
          ) : (
            canWrite && <OpenCaseButton creditId={item.creditId} />
          )}
          </>
        }
      />

      <div className="space-y-6">
        <Card>
          {/* Estado y prioridad son **controles**, no etiquetas: se tocan y se cambian acá mismo. Sin caso
              abierto no hay nada que cambiar, y se dice. */}
          <div className="flex flex-wrap items-center gap-2">
            {item.daysPastDue > 0 && <Badge tone="danger">{t('days', { n: item.daysPastDue })}</Badge>}
            {item.externalSource && (
              <SourceBadge
                source={item.externalSource}
                syncStatus={item.syncStatus}
                reportedAsOf={item.reportedAsOf}
                stale={item.reportedStale}
              />
            )}
            {open ? (
              <>
                <StatusControl caseId={open.id} status={open.status} canWrite={canWrite} />
                <PriorityCell caseId={open.id} priority={open.priority} pinned={open.priorityPinned} canWrite={canWrite} />
                {open.isOverdue && <Badge tone="danger">{t('overdueBadge')}</Badge>}
              </>
            ) : (
              <Badge tone="neutral">{t('noCase')}</Badge>
            )}
            {item.reportedStatus && <Badge tone="neutral">{item.reportedStatus}</Badge>}
          </div>

          {/* 🔴 El saldo total y lo realmente vencido son dos números distintos y se muestran por separado. */}
          <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('detail.balance')} value={amount(item.balance)} />
            <Fact label={t('detail.overdue')} value={amount(item.overdueAmount)} />
            <Fact label={t('columns.daysPastDue')} value={item.daysPastDue ? t('days', { n: item.daysPastDue }) : '—'} />
            <Fact label={t('detail.principal')} value={amount(item.principalAmount)} />
            <Fact label={t('detail.installment')} value={amount(item.installmentAmount)} />
            <Fact label={t('detail.nextDueDate')} value={day(item.nextDueDate)} />
            <Fact label={t('detail.lastPayment')} value={day(item.lastPaymentAt)} />
            <Fact label={t('detail.moraSince')} value={day(item.moraSince)} />
            <Fact label={t('detail.sla')} value={instant(open?.slaDueAt)} />
            {/* Sin nombre no es sin cobrador: `/users` da 403 sin `user:read`. */}
            <Fact
              label={t('detail.assignee')}
              value={assignee ? memberName(assignee) : open?.assigneeId ? t('unknownAssignee') : t('noAssignee')}
            />
            {item.branchName && <Fact label={t('columns.branch')} value={item.branchName} />}
          </dl>

          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2">
            <Link href={`/cartera/${item.clientId}`} className="text-[14px] font-medium text-k-purple hover:underline">
              {t('detail.openClient')}
            </Link>
            <Link
              href={`/cartera/${item.clientId}/credito/${item.creditId}`}
              className="text-[14px] font-medium text-k-purple hover:underline"
            >
              {t('detail.openCredit')}
            </Link>
          </div>
        </Card>

        {/* Qué se hizo para recuperarlo y qué se logró, sobre la mora actual. */}
        <RecoveryMetricsSection metrics={metrics.status === 200 ? (metrics.body.data ?? null) : null} currency={currency} />

        {/* Las notas van arriba: lo importante hay que leerlo antes de salir a cobrar. */}
        <NotesSection creditId={item.creditId} notes={notes.status === 200 ? (notes.body.data ?? []) : null} members={members} canWrite={canWrite} />

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            {/* Si el historial no se pudo leer (permiso, o la API todavía sin la migración), la ficha sigue entera. */}
            <ArrearsHistory episodes={episodes.status === 200 ? (episodes.body.data ?? []) : null} currency={currency} />

            <section>
          <h2 className="mb-3 text-[18px] font-semibold text-k-navy">{t('detail.timeline')}</h2>
          {item.activities.length ? (
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
                  {activity.result && <ActivityResult result={activity.result} />}
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
            <EmptyState title={open ? t('detail.timelineEmpty') : t('detail.noCaseTitle')} text={open ? undefined : t('detail.noCaseText')} />
          )}
            </section>
          </div>

          {/* La columna de consulta: qué prometió y qué pagó. */}
          <div className="space-y-6">
            <PromisesSection promises={promises.status === 200 ? (promises.body.data ?? []) : null} members={members} currency={currency} />
            <PaymentsSection
              creditId={item.creditId}
              payments={payments.status === 200 ? (payments.body.data ?? []) : null}
              members={members}
              currency={currency}
              external={!!item.externalSource}
            />
          </div>
        </div>

        {/* La persona, al servicio de la recuperación: sólo lectura (se corrige desde Cartera). */}
        <section>
          <h2 className="text-[18px] font-semibold text-k-navy">{t('ficha.person.title')}</h2>
          <p className="mb-3 mt-1 text-[13px] text-k-text-2">{t('ficha.person.hint')}</p>
          {client.status === 200 && client.body.data ? (
            <PersonSections
              creditId={item.creditId}
              client={client.body.data}
              currency={currency}
              collateralTypes={collateralTypes.body.data ?? []}
            />
          ) : (
            <EmptyState title={t('ficha.person.denied')} />
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
