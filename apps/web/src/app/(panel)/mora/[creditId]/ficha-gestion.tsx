import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  memberName,
  Permission,
  type AccountInfo,
  type Assignee,
  type MeInfo,
  type Member,
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
import { Badge, EmptyState, PageHeader, Section } from '@/components/panel-ui';
import { SourceBadge } from '@/components/source-badge';
import { SituationBadge } from '@/components/situation-badge';
import { date, dateTime, dayDate, money } from '@/lib/format';
import { assignedTo } from '@/lib/mora';
import { isKnownRole } from '@/lib/team';
import { PaymentActions } from '../../pagos/payment-actions';
import { ActivityCard } from './activity-card';
import { ActivityResult } from './activity-result';
import { RegisterActivityButton } from './activity-form';
import { ArrearsHistory } from './arrears-history';
import { FichaSummary } from './ficha-summary';
import { NotesSection } from './notes-section';
import { PaymentsSection } from './payments-section';
import { PersonSections } from './person-sections';
import { PromisesSection } from './promises-section';
import { PsfNotice } from './psf-notice';
import { RecoveryMetricsSection } from './recovery-metrics';
import { ResponsiblesSection } from './responsibles-section';
import { WriteOffButton } from './write-off-button';
import { PriorityCell } from '../priority-cell';


/**
 * La ficha de **gestión de un crédito**: de quién es, cuánto debe, quién lo trabaja y qué se hizo.
 *
 * 🔴 **Sirve para cualquier crédito visible, esté o no en mora** (F4/08 · D4): registrar acciones, agendar y pagar no
 * exigen mora. Por eso el título dice «Gestión del crédito» y no «Mora». La situación (al día / en mora), la
 * categoría y el castigo vienen de la API; gestiones y promesas son información, no estados.
 *
 * 🔴 **La ruta es el crédito.** Un id que no es de un crédito visible da 404.
 *
 * El historial viene **en la misma llamada** (`activities`, ya ordenadas desc por la API) y se pinta en el
 * servidor: no tiene ni una interacción, y así no viaja como JavaScript al navegador.
 */
export async function FichaGestion({
  creditId,
  withHeader = true,
  withPerson = true,
}: {
  creditId: string;
  withHeader?: boolean;
  /**
   * Mostrar «La persona» (teléfonos, direcciones, garantes, garantías). Dentro de la parada de una ruta va **apagado**: ese
   * detalle ya vive en la ficha del cliente, y repetirlo acá alargaba la página y pedía datos que nadie miraba.
   */
  withPerson?: boolean;
}) {
  const t = await getTranslations('panel.mora');
  const locale = await getLocale();

  const [detail, episodes, metrics, promises, notes, payments, methods, banks, me, team, account] = await Promise.all([
    apiCall<MoraCreditDetail>(`/mora/${creditId}`, { method: 'GET', auth: true }),
    apiCall<MoraEpisode[]>(`/mora/${creditId}/episodes`, { method: 'GET', auth: true }),
    apiCall<RecoveryMetrics>(`/mora/${creditId}/metrics`, { method: 'GET', auth: true }),
    apiCall<MoraPromise[]>(`/mora/${creditId}/promises`, { method: 'GET', auth: true }),
    apiCall<CreditNote[]>(`/mora/${creditId}/notes`, { method: 'GET', auth: true }),
    apiCall<PaymentItem[]>(`/payments?creditId=${creditId}&limit=50`, { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.PAYMENT_METHOD}`, { method: 'GET', auth: true }),
    apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.BANK}`, { method: 'GET', auth: true }),
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<Member[]>('/users', { method: 'GET', auth: true }),
    apiCall<AccountInfo>('/accounts/me', { method: 'GET', auth: true }),
  ]);

  if (detail.status === 404) notFound();
  if (detail.status !== 200 || !detail.body.data) {
    return <EmptyState title={t('gestion.title')} text={detail.body.error?.message} />;
  }

  const item = detail.body.data;
  // Dependen del `clientId` que trae la ficha, así que van después. Un 403 (sin `client:read`) no tumba la página.
  const [client, collateralTypes, assignees] = await Promise.all([
    // Sin la sección de la persona no se piden ni el cliente ni el catálogo de garantías.
    withPerson ? apiCall<ClientDetail>(`/clients/${item.clientId}`, { method: 'GET', auth: true }) : Promise.resolve(null),
    withPerson
      ? apiCall<{ code: string; label: string }[]>(`/catalogs/${CatalogType.COLLATERAL_TYPE}`, { method: 'GET', auth: true })
      : Promise.resolve(null),
    // A quién se puede asignar: sólo lo pide quien reparte (`assignment:write`); el resto da 403.
    (me.body.data?.permissions ?? []).includes(Permission.ASSIGNMENT_WRITE)
      ? apiCall<Assignee[]>('/assignments/assignees', { method: 'GET', auth: true })
      : Promise.resolve(null),
  ]);
  const members = team.body.data ?? [];
  const permissions = me.body.data?.permissions ?? [];
  const currency = item.currency ?? account.body.data?.currencyCode ?? 'BOB';
  // Registrar una acción es de `collection:write`, sobre cualquier crédito que se vea (al día o en mora).
  const canWrite = permissions.includes(Permission.COLLECTION_WRITE);
  const canAssign = permissions.includes(Permission.ASSIGNMENT_WRITE);
  // Castigar: `credit:write` y alcance total (gerente, administrador). La API lo exige igual.
  const canWriteOff = permissions.includes(Permission.CREDIT_WRITE) && permissions.includes(Permission.DATA_SCOPE_ALL);
  const collectors = (assignees?.status === 200 ? (assignees.body.data ?? []) : []).map((a) => ({ userId: a.userId, name: a.name }));
  const people = [...members.map((m) => ({ userId: m.userId, name: memberName(m) })), ...collectors];
  const principalId = item.responsibleId ?? item.assignments.find((a) => a.kind === 'PRINCIPAL')?.userId;
  const responsibleName = principalId ? (people.find((p) => p.userId === principalId)?.name ?? t('unknownAssignee')) : t('noAssignee');
  // Promesa vigente y última gestión: datos sueltos. La vigente es la primera que vence.
  const activePromise = (promises.status === 200 ? (promises.body.data ?? []) : [])
    .filter((p) => p.status === 'ACTIVE')
    .sort((a, b) => a.promiseDate.localeCompare(b.promiseDate))[0];
  /** Un dato que puede faltar: «—», nunca 0 (un importado puede no traerlo). */
  const amount = (n: number | undefined) => (n === undefined ? '—' : money(n, currency));
  /** Un día civil (`YYYY-MM-DD`: próxima fecha, último pago, inicio de mora): en UTC, o Bolivia lo corre un día. */
  const day = (iso: string | undefined) => (iso ? dayDate(iso, locale) : '—');
  /** Un instante (la última gestión): sí va en hora local. */
  const instant = (iso: string | undefined) => (iso ? date(iso, locale) : '—');

  const actions = (
    <>
      {/* Registrar una gestión sirve con cualquier crédito que se vea, esté o no en mora. */}
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
      <WriteOffButton creditId={item.creditId} writtenOff={item.writtenOff} canWriteOff={canWriteOff} />
    </>
  );

  return (
    <>
      {withHeader ? (
        <PageHeader
          title={t('gestion.title')}
          subtitle={[item.clientName, item.code ? t('detail.creditCode', { code: item.code }) : null].filter(Boolean).join(' · ')}
          actions={actions}
        />
      ) : (
        // Dentro de la parada, la cabecera es la de la visita: las acciones del crédito van en una fila propia.
        <div className="mb-4 flex flex-wrap items-center justify-end gap-3">{actions}</div>
      )}

      <div data-note-anchor="PAGE" className="relative space-y-6">
        {/* El resumen: lo que se debe, en grande, y los datos del crédito. La situación (al día / en mora), la categoría
            y el castigo vienen de la API; la prioridad es un control del episodio de mora abierto (un crédito al día no tiene). */}
        <FichaSummary
          chips={
            <>
              <SituationBadge inline situation={item.situation} daysPastDue={item.daysPastDue} category={item.category} writtenOff={item.writtenOff} />
              {item.priority && <PriorityCell creditId={item.creditId} priority={item.priority} pinned={item.priorityPinned} canWrite={canWrite} />}
              {item.externalSource && (
                <SourceBadge source={item.externalSource} syncStatus={item.syncStatus} reportedAsOf={item.reportedAsOf} stale={item.reportedStale} />
              )}
              {item.reportedStatus && <Badge tone="neutral">{item.reportedStatus}</Badge>}
            </>
          }
          balance={item.balance}
          principal={item.principalAmount}
          overdue={item.overdueAmount}
          daysPastDue={item.daysPastDue}
          installment={item.installmentAmount}
          nextDueDate={day(item.nextDueDate)}
          lastPayment={day(item.lastPaymentAt)}
          moraSince={day(item.moraSince)}
          lastAction={instant(item.lastActionAt)}
          activePromise={activePromise ? `${amount(activePromise.amount)} · ${day(activePromise.promiseDate)}` : '—'}
          // Sin nombre no es sin responsable: `/users` da 403 sin `user:read`.
          assignee={responsibleName}
          branch={item.branchName}
          clientHref={`/cartera/${item.clientId}`}
          creditHref={`/cartera/${item.clientId}/credito/${item.creditId}`}
          amount={amount}
        />

        {/* Aviso del reporte PSF (D9): ausente no es pagado, y un dato viejo se avisa. No bloquea el trabajo de campo. */}
        <PsfNotice
          externalSource={item.externalSource}
          syncStatus={item.syncStatus}
          absentSince={item.absentSince}
          reportedAsOf={item.reportedAsOf}
          reportedStale={item.reportedStale}
        />

        {/* Quién atiende el crédito: responsable, reemplazo temporal y ayuda. */}
        <ResponsiblesSection creditId={item.creditId} assignments={item.assignments} people={people} collectors={collectors} canAssign={canAssign} />

        {/* Qué se hizo para recuperarlo y qué se logró, sobre la mora actual. */}
        <RecoveryMetricsSection metrics={metrics.status === 200 ? (metrics.body.data ?? null) : null} currency={currency} />

        {/* El resto, en acordeones: las **gestiones** abiertas de entrada (es lo que se mira todos los días). */}
        <div className="space-y-3">
          <Section title={t('detail.timeline')} anchor="TIMELINE" collapsible={{ open: true, count: item.activities.length }}>
            {item.activities.length ? (
          <ol className="space-y-2.5">
            {item.activities.map((activity) => (
              <li key={activity.id}>
                <ActivityCard
                  type={activity.type}
                  result={activity.result}
                  /* Un tipo que el diccionario no conoce se muestra crudo: la API puede sumar
                     uno nuevo, y esconderlo dejaría un renglón sin decir qué pasó. */
                  title={t.has(`activityType.${activity.type}`) ? t(`activityType.${activity.type}`) : activity.type}
                  when={dateTime(activity.createdAt, locale)}
                >
                  {activity.result && <ActivityResult result={activity.result} />}
                  {/*
                   * 🔴 La nota de una asignación es **un id**, no una frase: mostrarla cruda le
                   * ponía `bf2e039c-…` en la cara a quien mira la cobranza. Va el nombre, y al lado
                   * el cargo — que es lo que dice si el trabajo quedó en manos de un cobrador de calle o de
                   * una supervisora.
                   */}
                  {activity.type === 'ASSIGNMENT' && assignedTo(activity.notes) ? (
                    <Assignee id={assignedTo(activity.notes)!} members={members} />
                  ) : (
                    activity.notes && <p className="mt-0.5 text-[13px] text-k-text">{activity.notes}</p>
                  )}
                </ActivityCard>
              </li>
            ))}
          </ol>
            ) : (
              <EmptyState title={t('detail.timelineEmpty')} />
            )}
          </Section>

          <PromisesSection promises={promises.status === 200 ? (promises.body.data ?? []) : null} members={members} currency={currency} />

          {/* Las notas, con su tablero de post-its. */}
          <NotesSection
            creditId={item.creditId}
            notes={notes.status === 200 ? (notes.body.data ?? []) : null}
            members={members}
            canWrite={canWrite}
            userId={me.body.data?.userId}
            canAssign={canAssign}
          />

          <PaymentsSection
            creditId={item.creditId}
            payments={payments.status === 200 ? (payments.body.data ?? []) : null}
            members={members}
            currency={currency}
            external={!!item.externalSource}
          />

          {/* Si el historial no se pudo leer (permiso, o la API todavía sin la migración), la ficha sigue entera. */}
          <ArrearsHistory episodes={episodes.status === 200 ? (episodes.body.data ?? []) : null} currency={currency} />

          {/* La persona, al servicio de la recuperación: sólo lectura (se corrige desde Cartera). */}
          {withPerson && (
            <Section title={t('ficha.person.title')} anchor="PERSON" collapsible={{ scroll: false }}>
              <p className="mb-3 text-[13px] text-k-text-2">{t('ficha.person.hint')}</p>
              {client?.status === 200 && client.body.data ? (
                <PersonSections creditId={item.creditId} client={client.body.data} currency={currency} collateralTypes={collateralTypes?.body.data ?? []} />
              ) : (
                <EmptyState title={t('ficha.person.denied')} />
              )}
            </Section>
          )}
        </div>
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
  const t = await getTranslations('panel.mora');
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
