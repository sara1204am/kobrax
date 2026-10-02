'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CREDIT_SOURCES, memberName, type Member, type MoraCreditListItem } from '@kobrax/shared';
import { SourceBadge } from '@/components/source-badge';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { STATUS_TONE } from '@/lib/cases';
import { date, dayDate, money } from '@/lib/format';
import { BulkActions } from './bulk-actions';
import { ExportButtons } from './export-buttons';
import { PriorityCell } from './priority-cell';

/**
 * La central de mora: **una fila por crédito en mora**, con su caso abierto si lo tiene.
 *
 * 🔴 **La fila es el crédito, no el caso.** Antes era el caso, y un caso sólo existe si el trabajo diario
 * lo abrió: un crédito vencido sin cronograma, o importado con el reporte viejo, no aparecía. Acá el
 * Nº de crédito es la primera columna y lleva a su ficha; el cobrador, la prioridad y el estado de
 * gestión son datos del caso y salen «—» cuando no hay uno.
 *
 * 🔴 **Ausente no es cero.** Un importado puede no traer la cuota, el último pago o el monto vencido, y un
 * crédito propio sin cronograma no tiene vencido calculable: la API manda el campo ausente y acá se ve
 * «—». Un 0 diría «no debe nada vencido» de alguien con 40 días de mora.
 *
 * Es el formato de la cartera, no una tabla aparte: mismo `DataTable`, mismos filtros en el panel del
 * costado, mismas columnas configurables y la misma búsqueda. El orden, la página y los filtros **los
 * resuelve el servidor**: ordenar o filtrar acá tocaría sólo la página y dejaría al de 200 días
 * escondido en la cuarta.
 */
export function ArrearsTable({
  rows,
  meta,
  members,
  currency,
  filtered,
  userId,
  showAssignee,
  canWrite,
  canExport = false,
}: {
  rows: MoraCreditListItem[];
  meta: PageMeta;
  members: Member[];
  currency: string;
  filtered: boolean;
  userId?: string;
  /** Sin `case:assign` la API ya acota a lo propio: el filtro por cobrador no cambiaría nada. */
  showAssignee: boolean;
  /** `case:write` — quien no lo tiene ve la prioridad, no la cambia. */
  canWrite: boolean;
  /** `case:export` — baja la lista con sus filtros, su orden y su alcance. */
  canExport?: boolean;
}) {
  const t = useTranslations('panel.cases');
  const tsrc = useTranslations('creditSource');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));
  const dash = <span className="text-k-muted">—</span>;
  /** Un dato que puede faltar: «—» y nunca 0. */
  const amount = (n: number | undefined, cur: string) => (n === undefined ? dash : money(n, cur));
  /** Un día civil (`YYYY-MM-DD`): en UTC, porque en hora local Bolivia lo corre un día atrás. */
  const day = (iso: string | undefined) => (iso ? dayDate(iso, locale) : dash);

  const columns: Column<MoraCreditListItem>[] = [
    {
      // Primera columna: el número del crédito, que lleva a su ficha de recuperación.
      key: 'code',
      header: t('columns.code'),
      render: (c) => (
        <a href={`/mora/${c.creditId}`} className="font-semibold text-k-text hover:underline">
          {c.code ?? <span className="text-k-muted">{t('noCreditCode')}</span>}
        </a>
      ),
    },
    {
      key: 'client',
      header: t('columns.client'),
      render: (c) => <span className="text-k-text">{c.clientName ?? '—'}</span>,
    },
    {
      key: 'balance',
      header: t('columns.balance'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: (c) => amount(c.balance, c.currency ?? currency),
    },
    {
      /*
       * 🔴 **Lo realmente vencido, no el saldo.** Un crédito de 7.000 con 300 vencidos pide una
       * gestión distinta que uno con 7.000 vencidos. El tooltip dice de dónde sale el número: del
       * cronograma o de lo que reportó el archivo.
       */
      key: 'overdueAmount',
      header: t('columns.overdue'),
      numeric: true,
      render: (c) =>
        c.overdueAmount === undefined ? (
          dash
        ) : (
          <span title={c.overdueSource === 'REPORTED' ? t('overdueReported') : t('overdueSchedule')}>
            {money(c.overdueAmount, c.currency ?? currency)}
          </span>
        ),
    },
    {
      key: 'daysPastDue',
      header: t('columns.daysPastDue'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: (c) =>
        c.daysPastDue > 0 ? (
          <span className="font-semibold text-k-danger">{t('days', { n: c.daysPastDue })}</span>
        ) : (
          dash
        ),
    },
    {
      /*
       * 🔴 **Se cambia desde la propia celda.** La prioridad la calcula el sistema desde el saldo, la
       * mora y el riesgo — buena regla en general, y equivocada justo cuando más importa: un deudor
       * con dos días de atraso cae en baja aunque quien lo conoce sepa que hay que ir hoy. Cambiarla
       * la fija, y el candado lo dice. Sin caso abierto no hay prioridad que cambiar.
       */
      key: 'priority',
      header: t('columns.priority'),
      sortable: true,
      defaultDir: 'desc',
      center: true,
      render: (c) =>
        c.case ? (
          <PriorityCell caseId={c.case.id} priority={c.case.priority} pinned={c.case.priorityPinned} canWrite={canWrite} />
        ) : (
          <span className="text-[13px] text-k-muted">{t('noCase')}</span>
        ),
    },
    {
      key: 'assignee',
      header: t('columns.assignee'),
      /*
       * 🔴 Sin nombre NO es sin cobrador. `GET /users` da 403 sin `user:read` —que es justo lo que
       * le pasa a una supervisora— y también puede faltar quien fue dado de baja. Decir «Sin
       * cobrador» ahí hacía ver la cartera entera como sin repartir, y lleva a reasignar trabajo
       * que ya estaba distribuido.
       */
      render: (c) =>
        c.case?.assigneeId ? (
          (byId.get(c.case.assigneeId) ?? <span className="text-k-text-2">{t('unknownAssignee')}</span>)
        ) : (
          dash
        ),
    },
    {
      key: 'lastAction',
      header: t('columns.lastAction'),
      sortable: true,
      defaultDir: 'desc',
      render: (c) =>
        c.case?.lastActionAt ? (
          <span className="block">
            <span className="block">{date(c.case.lastActionAt, locale)}</span>
            {c.lastActivityType && (
              <span className="block text-[12px] text-k-muted">
                {t(`activityType.${c.lastActivityType}` as never)}
                {c.lastActivityResult ? ` · ${c.lastActivityResult}` : ''}
              </span>
            )}
          </span>
        ) : (
          dash
        ),
    },
    // Existen pero arrancan apagadas: se prenden con ⚙ Columnas. Dependen de qué trajo el archivo o de
    // cómo se creó el crédito, así que no son lo que una pantalla común a propios e importados necesita.
    {
      key: 'branch',
      header: t('columns.branch'),
      visibleByDefault: false,
      render: (c) => c.branchName ?? dash,
    },
    {
      key: 'caseStatus',
      header: t('columns.caseStatus'),
      visibleByDefault: false,
      render: (c) => (c.case ? <Badge tone={STATUS_TONE[c.case.status]}>{t(`status.${c.case.status}`)}</Badge> : dash),
    },
    {
      // Sólo importados que mapearon la columna Estado. En propios, y en importados sin ese dato: «—».
      key: 'originStatus',
      header: t('columns.originStatus'),
      visibleByDefault: false,
      render: (c) => c.reportedStatus ?? dash,
    },
    {
      key: 'principal',
      header: t('columns.principal'),
      visibleByDefault: false,
      numeric: true,
      render: (c) => amount(c.principalAmount, c.currency ?? currency),
    },
    {
      key: 'installment',
      header: t('columns.installment'),
      visibleByDefault: false,
      numeric: true,
      render: (c) => amount(c.installmentAmount, c.currency ?? currency),
    },
    { key: 'nextDueDate', header: t('columns.nextDueDate'), visibleByDefault: false, render: (c) => day(c.nextDueDate) },
    { key: 'lastPaymentAt', header: t('columns.lastPayment'), visibleByDefault: false, render: (c) => day(c.lastPaymentAt) },
    { key: 'moraSince', header: t('columns.moraSince'), visibleByDefault: false, render: (c) => day(c.moraSince) },
    {
      /*
       * 🔴 **De dónde sale el número de días.** No es decoración: le dice a quien mira cuánto
       * confiar en él. «Calculada» la mantiene el sistema todas las noches; «del archivo» vale
       * hasta la próxima importación; «a mano» la puso una persona y nadie la revisa.
       */
      key: 'arrearsSource',
      header: t('columns.arrearsSource'),
      visibleByDefault: false,
      render: (c) =>
        // D7/D9: la del banco se lee con su fuente y su corte — y con el aviso si faltó o está vieja.
        c.externalSource ? (
          <SourceBadge source={c.externalSource} syncStatus={c.syncStatus} reportedAsOf={c.reportedAsOf} stale={c.reportedStale} />
        ) : (
          <span className="text-[13px] text-k-text-2">{t(`arrearsSource.${c.arrearsSource}`)}</span>
        ),
    },
    {
      key: 'promise',
      header: t('columns.promise'),
      visibleByDefault: false,
      render: (c) => (c.hasActivePromise ? <Badge tone="warning">{t('hasPromise')}</Badge> : dash),
    },
    {
      key: 'slaDueAt',
      header: t('columns.slaDueAt'),
      sortable: true,
      visibleByDefault: false,
      render: (c) => (c.case?.slaDueAt ? <span className={c.case.isOverdue ? 'text-k-danger' : ''}>{date(c.case.slaDueAt, locale)}</span> : dash),
    },
  ];

  /** Los filtros del panel. **Las claves son las de la URL**; qué significa cada una, `moraListQuery`. */
  const filters: FilterDef[] = [
    ...(showAssignee
      ? [
          {
            keys: ['assigneeId'],
            label: t('filters.assignee'),
            type: 'select' as const,
            allLabel: t('filters.all'),
            options: members.map((m) => ({ value: m.userId, label: memberName(m) })),
          },
          // Quien reparte ve también lo que nadie tiene: casos sin cobrador y créditos sin caso.
          {
            keys: ['unassigned'],
            label: t('filters.unassignedCase'),
            type: 'radio' as const,
            options: [{ value: 'true', label: t('filters.unassigned') }],
          },
          {
            keys: ['hasCase'],
            label: t('filters.case'),
            type: 'select' as const,
            allLabel: t('filters.all'),
            options: [
              { value: 'true', label: t('filters.withCase') },
              { value: 'false', label: t('filters.withoutCase') },
            ],
          },
        ]
      : []),
    { keys: ['dpdMin', 'dpdMax'], label: t('filters.arrearsRange'), type: 'numberRange' },
    { keys: ['balanceMin', 'balanceMax'], label: t('filters.balanceRange'), type: 'numberRange' },
    {
      // D7: de qué fuente son los créditos. Kobrax = los que calcula el sistema; PSF = los reportados.
      keys: ['source'],
      label: tsrc('filter'),
      type: 'select' as const,
      allLabel: tsrc('all'),
      options: CREDIT_SOURCES.map((s) => ({ value: s, label: tsrc(s) })),
    },
    {
      keys: ['priority'],
      label: t('filters.priority'),
      type: 'select',
      allLabel: t('filters.all'),
      options: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })),
    },
    {
      // El estado del **caso**: los cerrados ya no son créditos en mora, así que no se ofrecen.
      keys: ['status'],
      label: t('filters.status'),
      type: 'select',
      allLabel: t('filters.all'),
      options: (['PENDING', 'ACTIVE', 'IN_NEGOTIATION', 'PROMISE_TO_PAY', 'PAID'] as const).map((s) => ({
        value: s,
        label: t(`status.${s}`),
      })),
    },
    {
      keys: ['hasPromise'],
      label: t('filters.promise'),
      type: 'radio',
      options: [{ value: 'true', label: t('filters.withPromise') }],
    },
    {
      /*
       * La pantalla abre sólo con los vencidos. Esto lo apaga — para el caso de «tengo el expediente
       * abierto de alguien que ya se puso al día y quiero verlo». Va último: es la excepción.
       */
      keys: ['todos'],
      label: t('filters.scope'),
      type: 'radio',
      options: [{ value: '1', label: t('filters.includeCurrent') }],
    },
    { keys: ['overdue'], label: t('filters.sla'), type: 'radio', options: [{ value: 'true', label: t('filters.slaOverdue') }] },
  ];

  return (
    <DataTable
      tableId="mora"
      userId={userId}
      columns={columns}
      rows={rows}
      rowKey={(c) => c.creditId}
      meta={meta}
      filters={filters}
      filtered={filtered}
      entityLabel={t('entity')}
      actions={canExport ? <ExportButtons /> : undefined}
      search={<SearchBox wide label={t('search.label')} placeholder={t('search.placeholder')} hint={t('search.hint')} />}
      /*
       * 🔴 **La única tabla del panel con selección de filas.** La cartera no la tiene por decisión
       * de producto, y sigue sin tenerla: acá se justifica porque repartir novecientos créditos
       * vencidos de a uno es media mañana, y porque las acciones que se ofrecen obligan a decir
       * **qué** se hace — no hay un «resolver» que vacíe filas sin dejar rastro.
       *
       * Las acciones operan sobre **casos**: la fila elegida es un crédito, así que se traduce a su caso
       * abierto y los créditos sin caso se dejan afuera, avisando cuántos.
       */
      selection={{
        render: (ids, clear) => {
          const picked = new Set(ids);
          const caseIds = rows.filter((r) => picked.has(r.creditId) && r.case).map((r) => r.case!.id);
          const left = ids.length - caseIds.length;
          return (
            <>
              {left > 0 && <span className="text-[13px] text-k-text-2">{t('bulkWithoutCase', { n: left })}</span>}
              {caseIds.length > 0 && (
                <BulkActions ids={caseIds} clear={clear} members={members} canAssign={showAssignee} canWrite={canWrite} />
              )}
            </>
          );
        },
      }}
      // Cartera sin mora y filtro que no encontró nada no son lo mismo: una es una buena noticia y
      // la otra se arregla borrando el filtro.
      empty={<EmptyState title={t('empty')} text={t('emptyText')} />}
      noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
    />
  );
}
