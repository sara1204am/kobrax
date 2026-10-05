'use client';

import { useLocale, useTranslations } from 'next-intl';
import { CREDIT_SOURCES, memberName, type ArrearCategory, type Member, type MoraCreditListItem } from '@kobrax/shared';
import { SourceBadge } from '@/components/source-badge';
import { SituationBadge } from '@/components/situation-badge';
import { EmptyState } from '@/components/panel-ui';
import { DataTable, type Column, type PageMeta } from '@/components/data-table';
import type { FilterDef } from '@/components/data-table-filters';
import { SearchBox } from '@/components/search-box';
import { date, dayDate, money } from '@/lib/format';
import { BulkActions, type Collector } from './bulk-actions';
import { ExportButtons } from './export-buttons';
import { PriorityCell } from './priority-cell';

/**
 * La central de mora: **una fila por crédito en mora**.
 *
 * 🔴 **La fila es el crédito** (F4/08: ya no existe el caso). El Nº de crédito es la primera columna y lleva a su
 * ficha. La situación (al día / en mora), la categoría y el castigo son datos del crédito que llegan de la API
 * —acá no se calcula ninguno—; la prioridad es la del episodio de mora abierto y sale «—» en uno al día.
 * Gestiones y promesas son información suelta: ninguna se muestra como un estado.
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
  collectors = [],
  categories = [],
  branches = [],
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
  /** A quién se puede asignar (`GET /assignments/assignees`): alimenta el filtro de responsable y las acciones masivas. */
  collectors?: Collector[];
  /** Los rangos de la cuenta (`GET /arrear-categories`): sólo se usan para ofrecer el filtro. */
  categories?: ArrearCategory[];
  branches?: { id: string; name: string }[];
  currency: string;
  filtered: boolean;
  userId?: string;
  /** Sin `assignment:write` la API ya acota a lo propio: el filtro por responsable no cambiaría nada. */
  showAssignee: boolean;
  /** `collection:write` — quien no lo tiene ve la prioridad, no la cambia. */
  canWrite: boolean;
  /** `collection:export` — baja la lista con sus filtros, su orden y su alcance. */
  canExport?: boolean;
}) {
  const t = useTranslations('panel.mora');
  const tsrc = useTranslations('creditSource');
  const locale = useLocale();
  const byId = new Map<string, string>([
    ...members.map((m) => [m.userId, memberName(m)] as const),
    ...collectors.map((c) => [c.userId, c.name] as const),
  ]);
  /** Quién puede ser responsable: lo que dejó asignar el servidor; si no hay, el equipo (si se puede leer). */
  const people: Collector[] = collectors.length > 0 ? collectors : members.map((m) => ({ userId: m.userId, name: memberName(m) }));
  const dash = <span className="text-k-muted">—</span>;
  /** Un dato que puede faltar: «—» y nunca 0. */
  const amount = (n: number | undefined, cur: string) => (n === undefined ? dash : money(n, cur));
  /** Un día civil (`YYYY-MM-DD`): en UTC, porque en hora local Bolivia lo corre un día atrás. */
  const day = (iso: string | undefined) => (iso ? dayDate(iso, locale) : dash);

  const columns: Column<MoraCreditListItem>[] = [
    {
      // Primera columna: el número del crédito, que lleva a su ficha.
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
      // Al día / En mora, categoría (de la API, con su color) y castigado aparte.
      key: 'situation',
      header: t('columns.situation'),
      render: (c) => <SituationBadge situation={c.situation} daysPastDue={c.daysPastDue} category={c.category} writtenOff={c.writtenOff} />,
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
       * la fija, y el candado lo dice. Es la del episodio abierto: un crédito al día no tiene.
       */
      key: 'priority',
      header: t('columns.priority'),
      sortable: true,
      defaultDir: 'desc',
      center: true,
      render: (c) =>
        c.priority ? <PriorityCell creditId={c.creditId} priority={c.priority} pinned={c.priorityPinned} canWrite={canWrite} /> : dash,
    },
    {
      key: 'responsible',
      header: t('columns.responsible'),
      /*
       * 🔴 Sin nombre NO es sin responsable. `GET /users` da 403 sin `user:read` —que es justo lo que
       * le pasa a una supervisora— y también puede faltar quien fue dado de baja. Decir «sin
       * responsable» ahí hacía ver la cartera entera como sin repartir, y lleva a reasignar trabajo
       * que ya estaba distribuido.
       */
      render: (c) =>
        c.responsibleId ? (byId.get(c.responsibleId) ?? <span className="text-k-text-2">{t('unknownAssignee')}</span>) : dash,
    },
    {
      // Sólo un dato (F4/08 · D2): ni se ordena ni cuenta como estado.
      key: 'lastAction',
      header: t('columns.lastAction'),
      render: (c) =>
        c.lastActionAt ? (
          <span className="block">
            <span className="block">{date(c.lastActionAt, locale)}</span>
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
      // Un dato suelto, no un estado: «promesa vigente» no cambia la situación del crédito.
      render: (c) => (c.hasActivePromise ? <span className="text-[13px] text-k-text-2">{t('activePromiseLabel')}</span> : dash),
    },
  ];

  /** Los filtros del panel. **Las claves son las de la URL**; qué significa cada una, `moraListQuery`. */
  const filters: FilterDef[] = [
    ...(showAssignee
      ? [
          {
            keys: ['assigneeId'],
            label: t('filters.responsible'),
            type: 'select' as const,
            allLabel: t('filters.all'),
            options: people.map((p) => ({ value: p.userId, label: p.name })),
          },
          // Quien reparte ve también lo que nadie tiene.
          {
            keys: ['unassigned'],
            label: t('filters.unassignedResponsible'),
            type: 'radio' as const,
            options: [{ value: 'true', label: t('filters.unassigned') }],
          },
        ]
      : []),
    ...(showAssignee && branches.length > 1
      ? [
          {
            keys: ['branchId'],
            label: t('filters.branch'),
            type: 'select' as const,
            allLabel: t('filters.allBranches'),
            options: branches.map((b) => ({ value: b.id, label: b.name })),
          },
        ]
      : []),
    // La categoría la configura la cuenta: las opciones salen de la API, no de una lista fija.
    ...(categories.length > 0
      ? [
          {
            keys: ['category'],
            label: t('filters.category'),
            type: 'select' as const,
            allLabel: t('filters.all'),
            options: categories.map((c) => ({ value: c.code, label: c.name && c.name !== c.code ? `${c.code} · ${c.name}` : c.code })),
          },
        ]
      : []),
    {
      keys: ['writtenOff'],
      label: t('filters.writtenOff'),
      type: 'select' as const,
      allLabel: t('filters.all'),
      options: [
        { value: 'true', label: t('filters.onlyWrittenOff') },
        { value: 'false', label: t('filters.withoutWrittenOff') },
      ],
    },
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
      keys: ['hasPromise'],
      label: t('filters.promise'),
      type: 'radio',
      options: [{ value: 'true', label: t('filters.withPromise') }],
    },
    {
      /*
       * La pantalla abre sólo con los vencidos (situación «En mora»). Esto lo apaga, para ver también a
       * quien está al día. Va último: es la excepción.
       */
      keys: ['todos'],
      label: t('filters.situation'),
      type: 'radio',
      options: [{ value: '1', label: t('filters.includeCurrent') }],
    },
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
       * Las acciones operan sobre **créditos**: la fila elegida es el crédito y su id es lo que viaja.
       */
      selection={{
        render: (ids, clear) => (
          <BulkActions ids={ids} clear={clear} collectors={people} canAssign={showAssignee} canWrite={canWrite} />
        ),
      }}
      // Cartera sin mora y filtro que no encontró nada no son lo mismo: una es una buena noticia y
      // la otra se arregla borrando el filtro.
      empty={<EmptyState title={t('empty')} text={t('emptyText')} />}
      noResults={<EmptyState title={t('noResults')} text={t('noResultsText')} />}
    />
  );
}
