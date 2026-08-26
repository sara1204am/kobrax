'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  resultKind,
  setupStep,
  type ColumnsPayload,
  type ConfigScreen,
  type ImportConfig,
  type ImportConfigPatch,
  type PortfolioSummary,
} from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components/ui';
import { Badge, Card } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import {
  configProgress,
  groupWarnings,
  patchConfig,
  postImportFile,
  rejectText,
  scopeRefName,
  warningText,
} from '@/lib/import';
import { errorText } from '@/lib/api-error';
import { SaveIndicator, StatusCard, Stepper, Summary, type SaveState } from './config-status';
import { ColumnsStep } from './columns-step';
import { RulesStep, SampleStep, ScopeStep, SourceCard, Step } from './setup-steps';

/** Cuántas filas de la vista previa se dibujan. La corrida procesa el archivo entero. */
const PREVIEW_ROWS = 10;

/**
 * Configurar la importación, **de punta a punta y en una sola pantalla**.
 *
 * Antes eran dos rutas: las siete decisiones acá y el emparejado —el 80 % del trabajo— detrás de un
 * link al pie de una tarjeta del medio. Partirlo no era sólo incómodo: **el archivo de muestra vive
 * en el estado de React y no sobrevive a un `router.push`**, así que la forma del archivo se elegía
 * a ciegas en una pantalla y el error recién aparecía en la otra, con el archivo ya perdido.
 *
 * Acá el dueño del estado es uno solo, y por eso el archivo se sube primero y sigue disponible
 * cuando se cambia la forma, se fija un ancla o se prueba la corrida.
 */
export function ImportSetup({ screen }: { screen: ConfigScreen }) {
  const t = useTranslations('panel.import');
  const locale = useLocale();

  const [config, setConfig] = useState<ImportConfig>(screen.config);
  const [columns, setColumns] = useState<ColumnsPayload | null>(null);
  // Se guarda el `File`, no su nombre: al fijar el ancla del PDF —o al cambiar la forma— hay que
  // volver a leerlo, y pedirle a la persona que lo busque de nuevo en el disco la deja trabada.
  const [sample, setSample] = useState<File | null>(null);
  const [test, setTest] = useState<PortfolioSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [askReset, setAskReset] = useState(false);

  /**
   * Guarda un parche. **La config que vuelve es la verdad**, no la que la pantalla creía tener:
   * es lo que hace que cambiar la forma del archivo borre el emparejado sin que acá haya una sola
   * línea que lo sepa.
   */
  async function save(patch: ImportConfigPatch): Promise<ImportConfig | null> {
    setError(null);
    setBusy(true);
    setSaveState('saving');
    const result = await patchConfig(patch);
    setBusy(false);
    if (!result.ok || !result.config) {
      setSaveState('idle');
      setError(errorText(result.error, t, locale));
      return null;
    }
    setConfig(result.config);
    setSaveState('saved');
    // Una prueba corrida contra la configuración anterior deja de valer: dejarla en pantalla diría
    // que un emparejado que ya cambió sigue estando bien.
    setTest(null);
    return result.config;
  }

  async function readSample(file: File): Promise<boolean> {
    setError(null);
    setReading(true);
    const result = await postImportFile<ColumnsPayload>(file, { columnsOnly: true });
    setReading(false);
    if (!result.ok || !result.data) {
      setError(errorText(result.error, t, locale));
      return false;
    }
    setColumns(result.data);
    setSample(file);
    setTest(null);
    return true;
  }

  /**
   * Guardar el ancla —o la forma— y **volver a leer la muestra con eso puesto**.
   *
   * Sin el ancla, el motor de PDF no encuentra la tabla y devuelve `labels: []`. Guardar y no
   * releer dejaba todos los «Sale de» ofreciendo sólo «Sin emparejar» para siempre, sin nada que
   * indicara que había que volver a subir el archivo — y es el paso que habilita el módulo entero.
   */
  async function saveAndReread(patch: ImportConfigPatch) {
    if (!(await save(patch)) || !sample) return;
    // Si la muestra ya no se puede leer con lo que se acaba de guardar —cambiar de `rows` a
    // `pdf-rows` con un CSV en la mano da `FILE_SHAPE_MISMATCH` antes de parsear— hay que soltarla.
    // Dejándola, el paso 3 sigue abierto ofreciendo los encabezados de la forma anterior, y toda
    // columna elegida ahí es una etiqueta que ya no existe.
    if (!(await readSample(sample))) {
      setColumns(null);
      setSample(null);
    }
  }

  /** Corre el archivo en seco. Es el `dryRun` que ya existía y que el panel nunca ofreció. */
  async function runTest() {
    if (!sample) return;
    setError(null);
    setBusy(true);
    const result = await postImportFile<PortfolioSummary>(sample, { dryRun: true });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(errorText(result.error, t, locale));
      return;
    }
    setTest(result.data);
  }

  const byFile = config.source === 'file';
  const progress = configProgress(config, screen.catalog);
  const canTest = Boolean(sample) && setupStep(config) === null && progress.blocking.length === 0;
  const days = config.fields.daysPastDue;

  const summaryRows = [
    { label: t('columns.sample'), value: sample?.name ?? t('setup.summaryNoFile'), ok: Boolean(sample) },
    {
      label: t('settings.scope'),
      value:
        config.scope.kind === 'account'
          ? t('scopes.account.label')
          : (scopeRefName(config.scope, screen.members, screen.branches, t) ?? t('settings.scopeRefMissing')),
      ok: config.scope.kind === 'account' || Boolean(config.scope.ref),
    },
    { label: t('settings.shape'), value: t(`profiles.${config.profile.kind}.label`) },
    {
      label: t('settings.columns'),
      value: t('columns.matchCount', { ready: progress.ready, total: progress.total }),
      ok: progress.ready === progress.total,
    },
    {
      label: t('columns.moraColDays'),
      value: days?.calibrated ? t('columns.calibrated') : t('setup.summaryMoraPending'),
      ok: Boolean(days?.calibrated),
    },
  ];

  return (
    <div className="space-y-6">
      <Stepper current={sample ? 1 : 0} />
      <ErrorBanner message={error} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <SourceCard config={config} busy={busy} onSave={save} />

          {/* Con la carga a mano el import no existe para esta empresa: no hay nada más que decidir. */}
          {byFile && (
            <>
              <Step n={1} title={t('setup.step1')} hint={t('setup.step1Hint')}>
                <SampleStep
                  config={config}
                  fileName={sample?.name ?? null}
                  columnCount={columns?.labels.length ?? null}
                  busy={busy}
                  reading={reading}
                  onPick={readSample}
                  // Cambiar la forma borra el emparejado del lado del servidor y cambia cómo se lee
                  // el archivo: hay que releer la muestra o los «Sale de» quedan con las etiquetas
                  // de la forma anterior.
                  onProfile={saveAndReread}
                />
                {columns && columns.labels.length === 0 && (
                  <p className="mt-4 rounded-xl bg-k-warning-bg px-4 py-3 text-[13px] text-k-warning-text">
                    {t('columns.noLabels')}
                  </p>
                )}
              </Step>

              <Step n={2} title={t('setup.step2')} hint={t('setup.step2Hint')}>
                <ScopeStep screen={screen} config={config} busy={busy} onSave={save} />
              </Step>

              <Step
                n={3}
                title={t('setup.step3')}
                hint={t('setup.step3Hint')}
                badge={
                  columns ? (
                    <Badge tone={progress.ready === progress.total ? 'success' : 'neutral'}>
                      {t('columns.matchCount', { ready: progress.ready, total: progress.total })}
                    </Badge>
                  ) : undefined
                }
                // Un control gris sin motivo es un bug para el usuario: se dice qué falta.
                blocked={columns ? undefined : t('setup.step3Blocked')}
              >
                {columns && (
                  <ColumnsStep
                    screen={screen}
                    config={config}
                    columns={columns}
                    busy={busy}
                    onSave={save}
                    onSaveAnchor={saveAndReread}
                  />
                )}
              </Step>

              <Step n={4} title={t('setup.step4')} hint={t('setup.step4Hint')}>
                <RulesStep config={config} busy={busy} onSave={save} />
              </Step>

              {/*
                Probar sin importar, con el resultado justo debajo del botón que lo pidió. Es el
                `dryRun` que ya existía: sin él, la única forma de saber si el emparejado está bien
                era importar de verdad y mirar la cartera rota.
              */}
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-k-text">{t('columns.testTitle')}</p>
                    <p className="mt-1 text-[13px] text-k-text-2">
                      {canTest ? t('columns.testHint') : t('columns.testBlocked')}
                    </p>
                  </div>
                  <span className="shrink-0">
                    <Button
                      variant="ghost"
                      disabled={busy || !canTest}
                      onClick={runTest}
                      className="sm:w-auto sm:px-5"
                    >
                      {t('columns.testCta')}
                    </Button>
                  </span>
                </div>
                {test && (
                  <div className="mt-5">
                    <DryRunPreview summary={test} />
                  </div>
                )}
              </Card>
            </>
          )}

          <div className="flex justify-end">
            <span className="w-full sm:w-auto">
              <Button variant="ghost" onClick={() => setAskReset(true)} disabled={busy} className="sm:px-5">
                {t('settings.reset')}
              </Button>
            </span>
          </div>
        </div>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-6 lg:self-start">
          <StatusCard progress={progress} />
          <Summary rows={summaryRows}>
            <SaveIndicator state={saveState} />
            {/* Todo se guarda al momento, así que «continuar» es navegar: no hay nada que enviar. */}
            <Link
              href="/import"
              className="flex h-12 w-full items-center justify-center rounded-xl bg-k-navy px-5 text-[15px] font-semibold text-white transition-colors hover:bg-k-slate"
            >
              {t('columns.continue')}
            </Link>
          </Summary>
        </div>
      </div>

      <Modal
        open={askReset}
        onClose={() => setAskReset(false)}
        title={t('settings.resetTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setAskReset(false)} className="sm:w-auto sm:px-5">
              {t('settings.cancel')}
            </Button>
            <Button
              onClick={() => {
                setAskReset(false);
                void save({ reset: true });
              }}
              className="sm:w-auto sm:px-5"
            >
              {t('settings.resetCta')}
            </Button>
          </>
        }
      >
        {t('settings.resetText')}
      </Modal>
    </div>
  );
}

/**
 * Lo que dejaría este archivo si se importara ahora.
 *
 * Se dibuja lo que la API devuelve y nada más: `toCreate` trae `code` y `clientName`, así que no
 * hay columnas de saldo ni de mora que mostrar. Inventarlas sería exactamente el error que esta
 * pantalla viene a evitar.
 */
export function DryRunPreview({ summary }: { summary: PortfolioSummary }) {
  const t = useTranslations('panel.import');
  const { counts, preview, plan } = summary;
  const kind = resultKind(counts.invalid, summary.idempotentSkip);
  const rows = preview.toCreate.slice(0, PREVIEW_ROWS);
  const warnings = groupWarnings(preview.warnings);

  return (
    <div className="min-w-0 rounded-xl border border-k-border bg-k-bg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-k-text">
          {t('columns.testResult', {
            created: counts.created,
            updated: counts.updated,
            setCurrent: counts.setCurrent,
          })}
        </p>
        <Badge tone={kind === 'ok' ? 'success' : 'warning'} dot>
          {kind === 'ok' ? t('columns.testOk') : t('columns.testWarned', { n: counts.invalid })}
        </Badge>
      </div>

      {plan && plan.over > 0 && (
        <p className="mt-3 rounded-lg bg-k-danger-bg px-3 py-2 text-[12px] text-k-danger">
          {t('run.planOver', { nuevos: counts.created, lugar: plan.roomLeft, sobran: plan.over })}
        </p>
      )}

      {rows.length > 0 && (
        // La tabla scrollea dentro de su caja: el `<body>` nunca se va de lado.
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[280px] text-[12px]">
            <thead>
              <tr className="border-b border-k-border text-left uppercase tracking-wide text-k-text-2">
                <th scope="col" className="pb-1.5 font-semibold">
                  {t('run.colCode')}
                </th>
                <th scope="col" className="pb-1.5 font-semibold">
                  {t('run.colClient')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-b border-k-border last:border-0">
                  <td className="py-1.5 pr-4 tabular-nums text-k-text">{r.code}</td>
                  <td className="truncate py-1.5 text-k-text-2">{r.clientName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Los motivos, agrupados: un archivo de 3.000 créditos puede traer 700 avisos idénticos. */}
      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-k-warning-text">
          {warnings.map((w) => (
            <li key={`${w.code}-${w.detail ?? ''}`}>
              {warningText(w, t)} {w.count > 1 && <span className="text-k-muted">×{w.count}</span>}
            </li>
          ))}
        </ul>
      )}
      {preview.invalid.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-k-danger">
          {[...new Set(preview.invalid.map((i) => i.reason))].map((reason) => (
            <li key={reason}>{rejectText(reason, t)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
