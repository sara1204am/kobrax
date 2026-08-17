'use client';

import { useLocale, useTranslations } from 'next-intl';
import { memberName, type CaseListItem, type Member } from '@kobrax/shared';
import { Badge, EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { PRIORITY_TONE, STATUS_TONE } from '@/lib/cases';
import { date, money } from '@/lib/format';
import { BulkActions } from './bulk-actions';
import { PriorityCell } from './priority-cell';

/**
 * La cartera en mora: **una fila por préstamo vencido**, con quién lo trabaja y cuánto lleva.
 *
 * 🔴 **Es el formato de la cartera, no una tabla aparte**: mismo `DataTable`, mismos filtros en el
 * panel del costado, mismas columnas configurables y la misma búsqueda. Antes tenía su propia fila
 * de desplegables encima de la tabla, así que las dos listas del panel —la cartera y ésta— se
 * operaban distinto para hacer lo mismo.
 *
 * El orden, la página y los filtros **los resuelve el servidor**: la mora y el saldo salen del
 * crédito, no del caso, así que ordenar o filtrar acá tocaría sólo las 20 filas de la página y
 * dejaría al de 200 días escondido en la cuarta.
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
}: {
  rows: CaseListItem[];
  meta: PageMeta;
  members: Member[];
  currency: string;
  filtered: boolean;
  userId?: string;
  /** Sin `case:assign` la API ya acota a lo propio: el filtro por cobrador no cambiaría nada. */
  showAssignee: boolean;
  /** `case:write` — quien no lo tiene ve la prioridad, no la cambia. */
  canWrite: boolean;
}) {
  const t = useTranslations('panel.cases');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  const columns: Column<CaseListItem>[] = [
    {
      key: 'client',
      header: t('columns.client'),
      render: (c) => (
        <a href={`/mora/${c.id}`} className="block hover:underline">
          <span className="block font-semibold text-k-text">{c.clientName ?? '—'}</span>
          <span className="block text-[12px] text-k-muted">{c.creditCode ?? t('noCreditCode')}</span>
        </a>
      ),
    },
    {
      key: 'daysPastDue',
      header: t('columns.daysPastDue'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: (c) =>
        c.daysPastDue && c.daysPastDue > 0 ? (
          <span className="font-semibold text-k-danger">{t('days', { n: c.daysPastDue })}</span>
        ) : (
          <span className="text-k-muted">—</span>
        ),
    },
    {
      key: 'balance',
      header: t('columns.balance'),
      sortable: true,
      defaultDir: 'desc',
      numeric: true,
      render: (c) => money(c.amount, c.currency ?? currency),
    },
    {
      /*
       * 🔴 **De dónde sale el número de días.** No es decoración: le dice a quien mira cuánto
       * confiar en él. «Calculada» la mantiene el sistema todas las noches; «del archivo» vale
       * hasta la próxima importación; «a mano» la puso una persona y nadie la revisa. Sin esta
       * columna, tres números que significan cosas distintas se leen como si fueran el mismo.
       */
      key: 'arrearsSource',
      header: t('columns.arrearsSource'),
      render: (c) => (
        <span className="text-[13px] text-k-text-2">{t(`arrearsSource.${c.arrearsSource ?? 'CALCULATED'}`)}</span>
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
        c.assigneeId ? (
          (byId.get(c.assigneeId) ?? <span className="text-k-text-2">{t('unknownAssignee')}</span>)
        ) : (
          <span className="text-k-muted">{t('noAssignee')}</span>
        ),
    },
    {
      /*
       * 🔴 **Se cambia desde la propia celda.** La prioridad la calcula el sistema desde el saldo, la
       * mora y el riesgo — buena regla en general, y equivocada justo cuando más importa: un deudor
       * con dos días de atraso cae en baja aunque quien lo conoce sepa que hay que ir hoy. Cambiarla
       * la fija, y el candado lo dice: si no, un préstamo de 200 días en baja parecería un cálculo
       * roto en vez de una decisión.
       */
      key: 'priority',
      header: t('columns.priority'),
      sortable: true,
      defaultDir: 'desc',
      center: true,
      render: (c) => (
        <PriorityCell caseId={c.id} priority={c.priority} pinned={c.priorityPinned} canWrite={canWrite} />
      ),
    },
    // Existen pero arrancan apagadas: se prenden con ⚙ Columnas. El estado del expediente y su SLA
    // se miran cuando algo se atascó, no todos los días.
    {
      key: 'status',
      header: t('columns.status'),
      visibleByDefault: false,
      render: (c) => <Badge tone={STATUS_TONE[c.status]}>{t(`status.${c.status}`)}</Badge>,
    },
    {
      key: 'slaDueAt',
      header: t('columns.slaDueAt'),
      sortable: true,
      visibleByDefault: false,
      render: (c) => <span className={c.isOverdue ? 'text-k-danger' : ''}>{date(c.slaDueAt, locale)}</span>,
    },
  ];

  /** Los filtros del panel. **Las claves son las de la URL**; qué significa cada una, `moraQuery`. */
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
        ]
      : []),
    { keys: ['dpdMin', 'dpdMax'], label: t('filters.arrearsRange'), type: 'numberRange' },
    {
      keys: ['priority'],
      label: t('filters.priority'),
      type: 'select',
      allLabel: t('filters.all'),
      options: (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((p) => ({ value: p, label: t(`priority.${p}`) })),
    },
    {
      keys: ['status'],
      label: t('filters.status'),
      type: 'select',
      allLabel: t('filters.all'),
      options: (['PENDING', 'ACTIVE', 'IN_NEGOTIATION', 'PROMISE_TO_PAY', 'PAID', 'CLOSED'] as const).map((s) => ({
        value: s,
        label: t(`status.${s}`),
      })),
    },
    {
      /*
       * La pantalla abre con `dpdMin=1`. Esto lo apaga — para el caso de «tengo el expediente
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
      rowKey={(c) => c.id}
      meta={meta}
      filters={filters}
      filtered={filtered}
      entityLabel={t('entity')}
      search={<SearchBox wide label={t('search.label')} placeholder={t('search.placeholder')} hint={t('search.hint')} />}
      /*
       * 🔴 **La única tabla del panel con selección de filas.** La cartera no la tiene por decisión
       * de producto, y sigue sin tenerla: acá se justifica porque repartir novecientos préstamos
       * vencidos de a uno es media mañana, y porque las dos acciones que se ofrecen obligan a decir
       * **qué** se hace — no hay un «resolver» que vacíe filas sin dejar rastro.
       */
      selection={{
        render: (ids, clear) => (
          <BulkActions ids={ids} clear={clear} members={members} canAssign={showAssignee} canWrite={canWrite} />
        ),
      }}
      // Cartera sin mora y filtro que no encontró nada no son lo mismo: una es una buena noticia y
      // la otra se arregla borrando el filtro.
      empty={<EmptyState title={t('empty')} text={t('emptyText')} />}
      noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
    />
  );
}
