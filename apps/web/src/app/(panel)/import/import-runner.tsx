'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { resultKind, setupStep, type ImportConfig, type PortfolioSummary } from '@kobrax/shared';
import { Button, ErrorBanner } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-table';
import { EmptyState } from '@/components/panel-ui';
import { errorText, postImportFile, rejectText, warningText, type Translator } from '@/lib/import';

/**
 * El import del día, en tres estados sobre el mismo `File` en memoria.
 *
 * El archivo **se sube dos veces**: una para la vista previa (`dryRun`) y otra al confirmar. Es
 * correcto y no un descuido: la previa no guarda nada, y entre una y otra la cartera pudo cambiar.
 */
export function ImportRunner({ config }: { config: ImportConfig }) {
  const t = useTranslations('panel.import');
  const locale = useLocale();
  const router = useRouter();
  const filePicker = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(chosen: File, dryRun: boolean) {
    setError(null);
    setBusy(true);
    const result = await postImportFile<PortfolioSummary>(chosen, { dryRun });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(errorText(result.error, t, locale));
      return;
    }
    setSummary(result.data);
    // La tarjeta de la última corrida la pintó el servidor: sin esto sigue mostrando la anterior.
    if (!dryRun) router.refresh();
  }

  function choose(chosen: File) {
    setFile(chosen);
    setSummary(null);
    void run(chosen, true);
  }

  function reset() {
    setFile(null);
    setSummary(null);
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
        {/* «Ya se había importado» llega con los conteos de aquella corrida y SIN listas. */}
        {!summary.idempotentSkip && <Buckets summary={summary} t={t} />}
      </div>
    );
  }

  // ── Vista previa ───────────────────────────────────────────────────────────
  if (summary && file) {
    return (
      <div className="space-y-6">
        <ErrorBanner message={error} />
        <div className="rounded-2xl border border-k-border bg-white p-6">
          <p className="text-[18px] font-semibold text-k-navy">{t('run.previewTitle')}</p>
          <p className="mt-1 text-[14px] text-k-text-2">{t('run.previewNote')}</p>
          <p className="mt-3 truncate text-[13px] text-k-text-2">
            {t('run.file')}: <span className="text-k-text">{file.name}</span>
          </p>
          <Counts summary={summary} t={t} />
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
                onClick={() => void run(file, false)}
                className="sm:w-auto sm:px-12"
              >
                {t('run.confirm')}
              </Button>
            </span>
          </div>
        </div>
        <Buckets summary={summary} t={t} />
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
  const tiles = [
    ['created', summary.counts.created],
    ['updated', summary.counts.updated],
    ['setCurrent', summary.counts.setCurrent],
    ['invalid', summary.counts.invalid],
  ] as const;

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
function Buckets({ summary, t }: { summary: PortfolioSummary; t: Translator }) {
  const { toCreate, toUpdate, toSetCurrent, invalid, warnings } = summary.preview;

  return (
    <>
      {warnings.length > 0 && (
        <section className="rounded-2xl border-l-[3px] border-k-warning bg-k-warning-bg px-4 py-3">
          <h2 className="text-[14px] font-semibold text-k-warning-text">{t('run.warnings')}</h2>
          <ul className="mt-1 space-y-1 text-[13px] text-k-warning-text">
            {warnings.map((warning, i) => (
              <li key={`${warning.code}-${i}`}>{warningText(warning, t)}</li>
            ))}
          </ul>
        </section>
      )}

      <Bucket
        title={t('run.created')}
        hint={t('run.createdHint')}
        rows={toCreate}
        columns={[
          { key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code },
          { key: 'name', header: t('run.colClient'), sortable: false, render: (row) => row.clientName },
        ]}
        empty={t('run.emptyBucket')}
      />

      <Bucket
        title={t('run.updated')}
        hint={t('run.updatedHint')}
        rows={toUpdate}
        columns={[{ key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code }]}
        empty={t('run.emptyBucket')}
      />

      <Bucket
        title={t('run.setCurrent')}
        hint={t('run.setCurrentHint')}
        rows={toSetCurrent}
        columns={[{ key: 'code', header: t('run.colCode'), sortable: false, render: (row) => row.code ?? '—' }]}
        empty={t('run.emptyBucket')}
      />

      <Bucket
        title={t('run.invalid')}
        hint={t('run.invalidHint')}
        rows={invalid}
        columns={[
          { key: 'index', header: t('run.colRow'), sortable: false, numeric: true, render: (row) => row.index },
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
}: {
  title: string;
  hint: string;
  rows: R[];
  columns: Column<R>[];
  empty: string;
}) {
  // La llave es la posición: estas listas están en memoria, no se ordenan ni se filtran, y el
  // código del crédito no sirve — `toSetCurrent` lo trae nulo y el archivo puede repetirlo.
  const keys = new Map<R, string>(rows.map((row, i) => [row, String(i)]));

  return (
    <section className="space-y-2">
      <h2 className="text-[16px] font-semibold text-k-navy">
        {title} <span className="tabular-nums text-k-text-2">({rows.length})</span>
      </h2>
      <p className="text-[13px] text-k-text-2">{hint}</p>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => keys.get(row) ?? ''}
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
