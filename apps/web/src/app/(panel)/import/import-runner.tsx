'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { resultKind, setupStep, type Assignee, type ImportConfig, type PortfolioSummary, type ScopeMember } from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/panel-ui';
import {
  ACCEPTED_FILES,
  assignCodes,
  assignmentStats,
  buildAssignmentsPayload,
  groupWarnings,
  initialAssignState,
  pendingReassignments,
  postImportFile,
  rejectText,
  warningText,
  type AssignState,
} from '@/lib/import';
import { Modal } from '@/components/modal';
import { dateTime } from '@/lib/format';
import { AssignBar, AssigneeSelect, AssignToolbar, type NameOf } from './assignment-controls';
import { errorText, type Translator } from '@/lib/api-error';
import { money } from '@/lib/format';
import { useToast } from '@/components/toast';
import { ValueChange } from './value-change';

/**
 * El import del día, en tres estados sobre el mismo `File` en memoria.
 *
 * El archivo **se sube dos veces**: una para la vista previa (`dryRun`) y otra al confirmar. Es
 * correcto y no un descuido: la previa no guarda nada, y entre una y otra la cartera pudo cambiar.
 */
export function ImportRunner({
  config,
  currency,
  assignees,
  members,
}: {
  config: ImportConfig;
  currency: string;
  /** A quién se puede asignar (vacío sin `assignment:write`: el cobrador no reparte). */
  assignees: Assignee[];
  /** Todo el equipo, para poner nombre al responsable actual aunque no sea asignable. */
  members: ScopeMember[];
}) {
  const t = useTranslations('panel.import');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const filePicker = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Quién queda responsable de cada crédito, por nº de operación. Nace de la vista previa. */
  const [plan, setPlan] = useState<AssignState | null>(null);
  const [askReassign, setAskReassign] = useState(false);

  const ta = useTranslations('panel.import.assign');
  const nameOf: NameOf = (userId) => {
    if (!userId) return ta('unassigned');
    const a = assignees.find((x) => x.userId === userId);
    if (a) return a.isMe ? ta('me', { name: a.name }) : a.name;
    return members.find((m) => m.id === userId)?.name ?? ta('unknownUser');
  };

  async function run(chosen: File, dryRun: boolean) {
    setError(null);
    setAskReassign(false);
    setBusy(true);
    // Al confirmar viaja el reparto, sólo si quien importa reparte. El cobrador no manda nada: el
    // servidor ya sabe que lo nuevo es suyo.
    const assignments =
      !dryRun && summary?.assignment?.mode === 'CHOOSE' && plan ? buildAssignmentsPayload(plan, summary) : undefined;
    const result = await postImportFile<PortfolioSummary>(chosen, { dryRun, assignments });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(errorText(result.error, t, locale));
      return;
    }
    setSummary(result.data);
    if (dryRun) {
      setPlan(initialAssignState(result.data));
      return;
    }
    // El historial lo pinta el servidor: sin esto sigue mostrando la corrida anterior.
    router.refresh();
    /*
     * El aviso de que quedó guardado, como en el resto del panel. Con filas rechazadas es un aviso
     * y no un éxito: se importó, pero no todo. El mismo archivo otra vez no guardó nada.
     */
    const { counts, idempotentSkip } = result.data;
    const kind = resultKind(counts.invalid, idempotentSkip);
    if (kind === 'skipped') toast(t('run.toastSkipped'), 'warning');
    else if (kind === 'warned') toast(t('run.toastWarned', { n: counts.invalid }), 'warning');
    else toast(t('run.toastOk', { created: counts.created, updated: counts.updated }));
  }

  function choose(chosen: File) {
    setFile(chosen);
    setSummary(null);
    void run(chosen, true);
  }

  function reset() {
    setFile(null);
    setSummary(null);
    setPlan(null);
    setError(null);
  }

  // Con la carga a mano el módulo no existe para esta empresa: no se ofrece dropzone.
  if (config.source === 'manual') {
    return <Gate title={t('run.disabledTitle')} text={t('run.disabledText')} cta={t('run.setupCta')} />;
  }
  const step = setupStep(config);
  if (step) {
    return <Gate title={t('run.setupTitle')} text={t(`run.setup.${step}`)} cta={t('run.setupCta')} />;
  }

  // ── Resultado ──────────────────────────────────────────────────────────────
  // Qué corrida es la que volvió lo dice el servidor (`dryRun` viaja de vuelta en el summary):
  // un estado propio acá sería una segunda verdad sobre lo mismo, y podría desincronizarse.
  if (summary && !summary.dryRun) {
    const kind = resultKind(summary.counts.invalid, summary.idempotentSkip);
    return (
      <div className="space-y-6">
        <ErrorBanner message={error} />
        <div className="rounded-2xl border border-k-border bg-white p-6">
          <p className="text-[18px] font-semibold text-k-navy">{t('run.resultTitle')}</p>
          <p className="mt-1 text-[14px] text-k-text-2">
            {kind === 'skipped'
              ? t('run.resultSkipped')
              : kind === 'warned'
                ? t('run.resultWarned', { n: summary.counts.invalid })
                : t('run.resultOk')}
          </p>
          <Counts summary={summary} t={t} />
          <div className="mt-5 sm:w-56">
            <Button onClick={reset}>{t('run.again')}</Button>
          </div>
        </div>
        {!summary.idempotentSkip && <AssignResult summary={summary} nameOf={nameOf} />}
        {/* «Ya se había importado» llega con los conteos de aquella corrida y SIN listas. */}
        {!summary.idempotentSkip && <Buckets summary={summary} t={t} currency={currency} nameOf={nameOf} />}
      </div>
    );
  }

  // ── Vista previa ───────────────────────────────────────────────────────────
  if (summary && file) {
    // `plan` ausente = el plan no tiene tope de créditos; nada que avisar.
    const seExcede = (summary.plan?.over ?? 0) > 0;
    const choosing = summary.assignment?.mode === 'CHOOSE' && plan !== null;
    const stats = plan ? assignmentStats(plan.create) : null;
    const reassigns = choosing ? pendingReassignments(plan!, summary) : [];
    const sinAsignar = choosing ? stats!.unassigned : 0;
    // Lo que impide confirmar, en palabras. El botón se apaga y al lado se dice por qué.
    const bloqueo = summary.alreadyApplied
      ? ta('alreadyApplied', { date: dateTime(summary.alreadyApplied.at, locale), by: summary.alreadyApplied.by ?? 'none' })
      : sinAsignar > 0
        ? ta('blockUnassigned', { n: sinAsignar })
        : null;
    const confirmar = () => (reassigns.length > 0 ? setAskReassign(true) : void run(file, false));
    return (
      <div className="space-y-6">
        <ErrorBanner message={error} />
        <div className="rounded-2xl border border-k-border bg-white p-6">
          <p className="text-[18px] font-semibold text-k-navy">{t('run.previewTitle')}</p>
          <p className="mt-1 text-[14px] text-k-text-2">{t('run.previewNote')}</p>
          <p className="mt-3 truncate text-[13px] text-k-text-2">
            {t('run.file')}: <span className="text-k-text">{file.name}</span>
          </p>
          {/* D8 · D9: de qué día y de qué asesor es el reporte. Sin fecha de corte se dice: los
              números entran igual, pero sin saber a qué día corresponden. */}
          {summary.report && (
            <p className="mt-1 text-[13px] text-k-text-2">
              {summary.report.reportDate
                ? t('run.reportDate', { date: summary.report.reportDate.split('-').reverse().join('/') })
                : t('run.reportDateUnknown')}
              {summary.report.advisorCode && <> · {t('run.advisor', { code: summary.report.advisorCode })}</>}
            </p>
          )}
          <Counts summary={summary} t={t} />

          {/*
            🔴 El tope del plan, ANTES de confirmar. El servidor rechaza el archivo entero si se
            pasa —importar «hasta llenar» deja al cobrador saliendo a la calle con una cartera
            incompleta sin enterarse—, así que enterarse acá y no al final es toda la diferencia.
            El botón se apaga: no se ofrece algo que va a fallar.
          */}
          {seExcede && (
            <p className="mt-4 rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] leading-relaxed text-k-warning-text">
              {t('run.planOver', {
                nuevos: summary.counts.created,
                lugar: summary.plan!.roomLeft,
                sobran: summary.plan!.over,
              })}
            </p>
          )}

          {bloqueo && (
            <p className="mt-4 rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] leading-relaxed text-k-warning-text">{bloqueo}</p>
          )}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <span className="sm:w-auto">
              <Button variant="ghost" onClick={reset} disabled={busy} className="sm:w-auto sm:px-5">
                {t('run.cancel')}
              </Button>
            </span>
            <span className="sm:w-auto">
              <Button
                variant="cta"
                loading={busy}
                disabled={seExcede || bloqueo !== null}
                onClick={confirmar}
                className="sm:w-auto sm:px-12"
              >
                {t('run.confirm')}
              </Button>
            </span>
          </div>
        </div>
        <Buckets
          summary={summary}
          t={t}
          currency={currency}
          nameOf={nameOf}
          assigning={choosing ? { plan: plan!, setPlan, assignees, stats: stats! } : undefined}
        />

        {/* 🔴 Reasignar es otra acción que actualizar: antes de confirmar se dice cuántos cambian. */}
        <Modal
          open={askReassign}
          onClose={() => setAskReassign(false)}
          title={ta('reassignTitle')}
          actions={
            <>
              <span className="sm:w-40">
                <Button variant="ghost" onClick={() => setAskReassign(false)}>
                  {ta('back')}
                </Button>
              </span>
              <span className="sm:w-56">
                <Button loading={busy} onClick={() => void run(file, false)}>
                  {ta('reassignOk')}
                </Button>
              </span>
            </>
          }
        >
          <p className="text-[14px] text-k-text">{ta('reassignText', { n: reassigns.length })}</p>
          <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-[13px] text-k-text-2">
            {reassigns.map((r) => (
              <li key={r.code}>
                <span className="font-medium text-k-text">{r.code}</span>
                {r.clientName ? ` · ${r.clientName}` : ''} — {nameOf(r.from)} → <span className="font-semibold text-k-purple">{nameOf(r.to)}</span>
              </li>
            ))}
          </ul>
        </Modal>
      </div>
    );
  }

  // ── Elegir archivo ─────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          // El `busy` no es cosmético: soltar un segundo archivo encima del primero deja dos
          // lecturas en vuelo, y si la vieja contesta última, la vista previa muestra el nombre de
          // un archivo con los conteos del otro — y confirmar aplica el que nadie revisó.
          if (busy) return;
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) choose(dropped);
        }}
        className={`rounded-2xl border-2 border-dashed bg-white px-6 py-14 text-center transition-colors ${
          dragging ? 'border-k-purple bg-k-highlight' : 'border-k-border'
        }`}
      >
        <p className="text-[16px] font-medium text-k-text">{busy ? t('run.reading') : t('run.dropTitle')}</p>
        <p className="mt-1 text-[13px] text-k-text-2">{t(`profiles.${config.profile.kind}.format`)}</p>
        <input
          ref={filePicker}
          type="file"
          accept={ACCEPTED_FILES}
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            // Se limpia para que volver a elegir el MISMO archivo dispare `change` otra vez.
            e.target.value = '';
            if (chosen) choose(chosen);
          }}
        />
        <div className="mt-5 flex justify-center">
          <span className="w-full sm:w-56">
            <Button loading={busy} onClick={() => filePicker.current?.click()}>
              {t('run.pick')}
            </Button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Lo que hay que arreglar antes de poder importar. Siempre manda a Ajustes, que es donde se hace. */
function Gate({ title, text, cta }: { title: string; text: string; cta: string }) {
  return (
    <EmptyState
      title={title}
      text={text}
      action={
        <Link
          href="/import/ajustes"
          className="min-h-[40px] rounded-xl bg-k-navy px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-k-slate"
        >
          {cta}
        </Link>
      }
    />
  );
}

/** Los tres baldes + los rechazos, en números. **«Eliminados» no existe: el reconcile nunca borra.** */
function Counts({ summary, t }: { summary: PortfolioSummary; t: Translator }) {
  // Las de la operación externa (D2, D4) sólo aparecen si pasan: un 0 fijo en cada corrida de un
  // formato que no los usa sería ruido. Las tres de siempre, siempre.
  const extra = [
    ['absent', summary.counts.absent ?? 0],
    ['reappeared', summary.counts.reappeared ?? 0],
    ['needsReview', summary.counts.needsReview ?? 0],
    // Totales y notas debajo de la tabla: se saltan, no son registros ni errores.
    ['ignored', summary.counts.ignored ?? 0],
  ] as const;
  const tiles = [
    ['created', summary.counts.created],
    ['updated', summary.counts.updated],
    ...extra.filter(([, n]) => n > 0),
    ['invalid', summary.counts.invalid],
  ];

  return (
    <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map(([key, value]) => (
        <div key={key} className="rounded-xl bg-k-bg px-4 py-3">
          <dt className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t(`run.${key}`)}</dt>
          <dd className="mt-1 text-[22px] font-semibold tabular-nums text-k-navy">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * La lista COMPLETA de cada balde, no el corte de 8 del teléfono: es justo lo que aporta la
 * pantalla grande.
 *
 * ponytail: se dibujan todas las filas, sin virtualizar. Un archivo de 3.000 créditos son 3.000
 * `<tr>` y el navegador de escritorio los aguanta. Si aparece un tenant con decenas de miles, el
 * techo se sube con `content-visibility: auto` en las filas antes que con una librería.
 */
/** El reparto en curso, cuando quien importa reparte. Ausente = sólo se muestran los responsables. */
interface Assigning {
  plan: AssignState;
  setPlan: React.Dispatch<React.SetStateAction<AssignState | null>>;
  assignees: Assignee[];
  stats: ReturnType<typeof assignmentStats>;
}

function Buckets({
  summary,
  t,
  currency,
  nameOf,
  assigning,
}: {
  summary: PortfolioSummary;
  t: Translator;
  currency: string;
  nameOf: NameOf;
  assigning?: Assigning;
}) {
  const ta = useTranslations('panel.import.assign');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const { toCreate, toUpdate, invalid, warnings } = summary.preview;
  // Las columnas de responsable sólo si la API las manda (una vieja no) y, en existentes, sólo en la
  // vista previa: después de confirmar, «responsable actual» ya sería el de antes.
  const conResponsable = summary.assignment !== undefined;
  const selfPreview = summary.dryRun && summary.assignment?.mode === 'SELF';
  const setPlan = (fn: (p: AssignState) => AssignState) => assigning?.setPlan((p) => (p ? fn(p) : p));
  const conHint = (base: string, extra: string | null) => (extra ? `${base} ${extra}` : base);
  const toMarkAbsent = summary.preview.toMarkAbsent ?? [];
  const reappeared = toUpdate.filter((u) => u.reappeared);
  // Con la regla «al día», la ausente además queda sin atraso: su mora se muestra «antes → 0».
  const setCurrent = new Set(summary.preview.toSetCurrent.map((r) => r.code));

  /*
   * Quién es y con qué números, no sólo el nº de operación: «302-222-1515» no le dice nada a quien
   * tiene que decidir si confirma. `before` es cómo está hoy en Kobrax; `after`, lo que trae el reporte.
   */
  type Values = { outstandingBalance?: number | null; daysPastDue?: number | null; status?: string | null; reportedStatus?: string | null };
  const clientCol = <R extends { clientName?: string }>(): Column<R> => ({
    key: 'name',
    header: t('run.colClient'),
    sortable: false,
    render: (row) => row.clientName ?? <span className="text-k-muted">—</span>,
  });
  const balanceCol = <R,>(get: (row: R) => { before?: Values; after?: Values }): Column<R> => ({
    key: 'balance',
    header: t('run.colBalance'),
    numeric: true,
    sortable: false,
    render: (row) => {
      const v = get(row);
      return <ValueChange before={v.before?.outstandingBalance} after={v.after?.outstandingBalance} format={(n) => money(n, currency)} />;
    },
  });
  const arrearsCol = <R,>(get: (row: R) => { before?: Values; after?: Values }): Column<R> => ({
    key: 'arrears',
    header: t('run.colArrears'),
    numeric: true,
    sortable: false,
    render: (row) => {
      const v = get(row);
      return <ValueChange before={v.before?.daysPastDue} after={v.after?.daysPastDue} format={(n) => t('detail.days', { n })} />;
    },
  });
  const statusCol = <R,>(get: (row: R) => Values | undefined): Column<R> => ({
    key: 'status',
    header: t('run.colStatus'),
    sortable: false,
    // El estado como lo escribe el banco («Vencida», «Ejecución») dice más que el nuestro.
    render: (row) => <span className="text-[13px] text-k-text-2">{get(row)?.reportedStatus ?? '—'}</span>,
  });
  type Preview = PortfolioSummary['preview'];
  type CreateRow = Preview['toCreate'][number];
  type UpdateRow = Preview['toUpdate'][number];
  type AbsentRow = NonNullable<Preview['toMarkAbsent']>[number];
  type InvalidRow = Preview['invalid'][number];
  const same = (row: UpdateRow) => row;

  return (
    <>
      {warnings.length > 0 && (
        <section className="rounded-2xl border-l-[3px] border-k-warning bg-k-warning-bg px-4 py-3">
          <h2 className="text-[14px] font-semibold text-k-warning-text">{t('run.warnings')}</h2>
          <ul className="mt-1 space-y-1 text-[13px] text-k-warning-text">
            {/* Agrupados: `MORA_INCONSISTENTE` sale una vez por FILA, así que sin esto 700 filas
                sospechosas dibujan 700 renglones iguales y empujan fuera de la pantalla a los dos
                avisos accionables — justo donde se decide si confirmar. */}
            {groupWarnings(warnings).map((warning) => (
              <li key={`${warning.code}-${warning.detail ?? ''}`}>
                {warningText(warning, t)}
                {warning.count > 1 && <span className="tabular-nums"> ×{warning.count}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Bucket
        title={t('run.created')}
        hint={conHint(t('run.createdHint'), assigning ? ta('chooseNew') : selfPreview ? ta('selfNew') : null)}
        rows={assigning && onlyUnassigned ? toCreate.filter((r) => !assigning.plan.create[r.code]) : toCreate}
        rowKey={(row) => row.code}
        toolbar={
          assigning && toCreate.length > 0 ? (
            <AssignToolbar
              stats={assigning.stats}
              nameOf={nameOf}
              assignees={assigning.assignees}
              onlyUnassigned={onlyUnassigned}
              onOnlyUnassigned={setOnlyUnassigned}
              onAssignUnassigned={(userId) =>
                setPlan((p) => assignCodes(p, 'create', Object.keys(p.create).filter((c) => !p.create[c]), userId))
              }
            />
          ) : undefined
        }
        selection={
          assigning
            ? {
                render: (ids, clear) => (
                  <AssignBar
                    count={ids.length}
                    assignees={assigning.assignees}
                    verb={ta('assignTo')}
                    onAssign={(userId) => {
                      setPlan((p) => assignCodes(p, 'create', ids, userId));
                      clear();
                    }}
                  />
                ),
              }
            : undefined
        }
        columns={[
          { key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code },
          {
            key: 'name',
            header: t('run.colClient'),
            sortable: false,
            // D2: el cliente que se parece a otro entra igual, marcado para revisar el vínculo.
            render: (row) => (
              <>
                {row.clientName}
                {row.linkReview && <span className="ml-2 text-[12px] font-semibold text-k-warning-text">{t('run.linkReview')}</span>}
                {row.existingClient && <span className="ml-2 text-[12px] text-k-text-2">{t('run.existingClient')}</span>}
              </>
            ),
          },
          balanceCol<CreateRow>((row) => ({ after: row.after })),
          arrearsCol<CreateRow>((row) => ({ after: row.after })),
          statusCol<CreateRow>((row) => row.after),
          ...(conResponsable
            ? [
                {
                  key: 'assignee',
                  header: ta('colAssignee'),
                  sortable: false,
                  render: (row: CreateRow) =>
                    assigning ? (
                      <span className="flex items-center gap-2">
                        <AssigneeSelect
                          value={assigning.plan.create[row.code] ?? null}
                          onChange={(userId) => setPlan((p) => assignCodes(p, 'create', [row.code], userId))}
                          assignees={assigning.assignees}
                          nameOf={nameOf}
                          allowEmpty
                          label={`${ta('colAssignee')} · ${row.code}`}
                        />
                        {row.suggestedAssigneeId && assigning.plan.create[row.code] === row.suggestedAssigneeId && (
                          <span className="text-[11px] text-k-muted">{ta('suggested')}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[13px] text-k-text-2">{nameOf(row.suggestedAssigneeId)}</span>
                    ),
                } satisfies Column<CreateRow>,
              ]
            : []),
        ]}
        empty={t('run.emptyBucket')}
      />

      <Bucket
        title={t('run.updated')}
        hint={conHint(t('run.updatedHint'), assigning ? ta('chooseUpdate') : selfPreview ? ta('keepCurrent') : null)}
        rows={toUpdate}
        rowKey={(row) => row.code}
        selection={
          assigning
            ? {
                render: (ids, clear) => (
                  <AssignBar
                    count={ids.length}
                    assignees={assigning.assignees}
                    verb={ta('reassignTo')}
                    onAssign={(userId) => {
                      setPlan((p) => assignCodes(p, 'update', ids, userId));
                      clear();
                    }}
                  />
                ),
              }
            : undefined
        }
        columns={[
          { key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code },
          clientCol<UpdateRow>(),
          balanceCol<UpdateRow>(same),
          arrearsCol<UpdateRow>(same),
          statusCol<UpdateRow>((row) => row.after),
          ...(conResponsable && summary.dryRun
            ? [
                {
                  key: 'current',
                  header: ta('colCurrent'),
                  sortable: false,
                  render: (row: UpdateRow) => <span className="text-[13px] text-k-text-2">{nameOf(row.currentAssigneeId)}</span>,
                } satisfies Column<UpdateRow>,
              ]
            : []),
          ...(assigning
            ? [
                {
                  key: 'next',
                  header: ta('colNew'),
                  sortable: false,
                  render: (row: UpdateRow) => {
                    const next = assigning.plan.update[row.code] ?? null;
                    const changed = next !== (row.currentAssigneeId ?? null);
                    return (
                      <span className="flex items-center gap-2">
                        <AssigneeSelect
                          value={next}
                          // Un existente no queda «sin asignar» por la importación: vaciar vuelve al de hoy.
                          onChange={(userId) => setPlan((p) => assignCodes(p, 'update', [row.code], userId ?? row.currentAssigneeId ?? null))}
                          assignees={assigning.assignees}
                          nameOf={nameOf}
                          label={`${ta('colNew')} · ${row.code}`}
                          highlight={changed}
                        />
                        {changed && (
                          <span className="rounded bg-k-highlight px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-k-purple">
                            {ta('reassignBadge')}
                          </span>
                        )}
                      </span>
                    );
                  },
                } satisfies Column<UpdateRow>,
              ]
            : []),
        ]}
        empty={t('run.emptyBucket')}
      />

      {reappeared.length > 0 && (
        <Bucket
          title={t('run.reappeared')}
          hint={t('run.reappearedHint')}
          rows={reappeared}
          columns={[
            { key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code },
            clientCol<UpdateRow>(),
            balanceCol<UpdateRow>(same),
            arrearsCol<UpdateRow>(same),
            statusCol<UpdateRow>((row) => row.after),
          ]}
          empty={t('run.emptyBucket')}
        />
      )}

      <Bucket
        title={t('run.absent')}
        hint={t('run.absentHint')}
        rows={toMarkAbsent}
        columns={[
          { key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code ?? '—' },
          clientCol<AbsentRow>(),
          // El saldo queda como está (D4); la mora, en 0 si la regla es «al día».
          balanceCol<AbsentRow>((row) => ({ before: row.before })),
          arrearsCol<AbsentRow>((row) => ({ before: row.before, after: setCurrent.has(row.code) ? { daysPastDue: 0 } : undefined })),
        ]}
        empty={t('run.emptyBucket')}
      />

      <Bucket
        title={t('run.invalid')}
        hint={t('run.invalidHint')}
        rows={invalid}
        columns={[
          { key: 'index', header: t('run.colRow'), sortable: false, numeric: true, render: (row) => row.index + 1 },
          { key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code ?? '—' },
          clientCol<InvalidRow>(),
          { key: 'reason', header: t('run.colReason'), sortable: false, render: (row) => rejectText(row.reason, t) },
        ]}
        empty={t('run.emptyBucket')}
      />
    </>
  );
}

function Bucket<R>({
  title,
  hint,
  rows,
  columns,
  empty,
  rowKey,
  selection,
  toolbar,
}: {
  title: string;
  hint: string;
  rows: R[];
  columns: Column<R>[];
  empty: string;
  /**
   * La llave de la fila. Por defecto la posición: `toSetCurrent` trae el código nulo y el archivo
   * puede repetirlo. Nuevos y existentes pasan el nº de operación —ahí es único (DUP_IN_FILE)—
   * porque la selección y el reparto se hacen por él.
   */
  rowKey?: (row: R) => string;
  selection?: { render: (ids: string[], clear: () => void) => React.ReactNode };
  /** Lo que va arriba de la tabla (el reparto de los nuevos). */
  toolbar?: React.ReactNode;
}) {
  const keys = new Map<R, string>(rows.map((row, i) => [row, rowKey ? rowKey(row) : String(i)]));

  return (
    <section className="space-y-2">
      <h2 className="text-[16px] font-semibold text-k-navy">
        {title} <span className="tabular-nums text-k-text-2">({rows.length})</span>
      </h2>
      <p className="text-[13px] text-k-text-2">{hint}</p>
      {toolbar}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => keys.get(row) ?? ''}
        selection={selection}
        // `pages: 1` deja el pie de paginación sin dibujar: esta lista está en memoria y no tiene
        // páginas que pedir. Y ninguna columna ordena — ordenar navega y perdería el `File`.
        meta={{ total: rows.length, page: 1, limit: Math.max(rows.length, 1), pages: 1 }}
        empty={
          <p className="rounded-2xl border border-dashed border-k-border bg-white px-4 py-6 text-center text-[13px] text-k-text-2">
            {empty}
          </p>
        }
      />
    </section>
  );
}

/**
 * Después de confirmar: con quién quedó cada nuevo, cuántos existentes se reasignaron, y lo que se
 * pidió y no se aplicó (por ejemplo, un nuevo que otra importación creó entre la vista previa y la
 * confirmación). No aparece si no hay nada que contar.
 */
function AssignResult({ summary, nameOf }: { summary: PortfolioSummary; nameOf: NameOf }) {
  const ta = useTranslations('panel.import.assign');
  const assigned = summary.assigned ?? [];
  const notes = summary.assignmentNotes ?? [];
  if (assigned.length === 0 && !summary.reassigned && notes.length === 0) return null;
  return (
    <section className="space-y-3 rounded-2xl border border-k-border bg-white p-5">
      {assigned.length > 0 && (
        <div>
          <h2 className="text-[14px] font-semibold text-k-navy">{ta('resultAssigned')}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {assigned.map((a) => (
              <span key={a.userId} className="rounded-full bg-k-bg px-2.5 py-1 text-[12px] text-k-text-2">
                {nameOf(a.userId)} <span className="font-semibold tabular-nums text-k-text">{a.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {!!summary.reassigned && <p className="text-[13px] text-k-text">{ta('resultReassigned', { n: summary.reassigned })}</p>}
      {notes.length > 0 && (
        <div className="rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
          <p className="font-semibold">{ta('notesTitle')}</p>
          <ul className="mt-1 space-y-0.5">
            {notes.map((n) => (
              <li key={`${n.externalId}-${n.reason}`}>{ta(`note.${n.reason}`, { code: n.externalId })}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
