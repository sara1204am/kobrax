'use client';

import { useTranslations } from 'next-intl';
import {
  previewName,
  type ColumnsPayload,
  type ConfigScreen,
  type ImportConfig,
  type ImportConfigPatch,
  type NameOrder,
} from '@kobrax/shared';
import { Button, Field, Select } from '@/components/ui';
import { Badge, Segmented } from '@/components/panel-ui';
import {
  DAYS_PAST_DUE,
  confirmDaysPastDue,
  pickDaysPastDue,
  trackedFields,
  usedColumns,
} from '@/lib/import';
import { FieldRow } from './field-row';

const NAME_ORDERS: NameOrder[] = ['full', 'surnames-first', 'split-columns'];

/**
 * Emparejar columnas: qué dato de la cartera sale de qué columna del archivo.
 *
 * El orden es el del riesgo, no el del modelo de datos: primero los días de atraso —de esa columna
 * depende quién aparece en mora—, después los datos que el import no puede suplir, y al final los
 * opcionales.
 */
export function ColumnsStep({
  screen,
  config,
  columns,
  busy,
  onSave,
  onSaveAnchor,
}: {
  screen: ConfigScreen;
  config: ImportConfig;
  columns: ColumnsPayload;
  busy: boolean;
  onSave: (patch: ImportConfigPatch) => void;
  /** Guarda el ancla del PDF y **vuelve a leer la muestra**. */
  onSaveAnchor: (patch: ImportConfigPatch) => void;
}) {
  const t = useTranslations('panel.import');

  const labels = columns.labels;
  const samples = columns.samples ?? {};
  const days = config.fields[DAYS_PAST_DUE];
  const candidate = columns.columnCandidates.find((c) => c.header === days?.from);

  const tracked = trackedFields(config, screen.catalog);
  /*
   * La mora queda FUERA de la lista: ya tiene su tarjeta arriba, con las candidatas del cuadro y el
   * confirmar en dos pasos. Dibujarla también acá daba un segundo control para el mismo campo que
   * escribe otro parche — limpia el `in` (en `pdf-blocks` manda al motor a buscar la columna en el
   * encabezado del bloque: entra toda la cartera con cero días de atraso, sin un solo error) y
   * arrastra el `calibrated` viejo, que el servidor rechaza con `CALIBRATION_STALE`. Sigue contando
   * en `configProgress`: sale de la lista, no del progreso.
   */
  const essential = tracked.filter((f) => screen.catalog[f]?.starred && f !== DAYS_PAST_DUE);
  const extra = tracked.filter((f) => !screen.catalog[f]?.starred);
  // Los bloqueados no se ofrecen para agregar: ya están arriba, con su aviso si les falta columna.
  const addable = Object.keys(screen.catalog).filter((f) => !tracked.includes(f) && !screen.catalog[f]?.locked);

  // Un nombre REAL del archivo: es lo único que deja elegir el corte sin adivinar.
  const realName =
    samples[config.fields.clientName?.from ?? '']?.[0] ??
    columns.columnCandidates[0]?.samples.find((s) => s.label)?.label ??
    null;

  const row = (field: string) => (
    <FieldRow
      key={field}
      field={field}
      catalog={screen.catalog}
      rule={config.fields[field]}
      labels={labels}
      samples={samples}
      used={usedColumns(config, field)}
      busy={busy}
      onSave={onSave}
    />
  );

  return (
    <div className="space-y-6">
      {/* Cada forma de archivo trae su propia pregunta pendiente. Una planilla no tiene ninguna. */}
      {config.profile.kind === 'pdf-blocks' && (
        <div className="max-w-xl">
          <Field label={t('columns.recordStart')} hint={t('columns.recordStartHint')}>
            <Select
              value={config.profile.recordStart ?? ''}
              disabled={busy}
              onChange={(e) => onSaveAnchor({ profile: { ...config.profile, recordStart: e.target.value } })}
            >
              <option value="">{t('columns.notMapped')}</option>
              {(columns.recordStartCandidates ?? []).map((c) => (
                <option key={c.text} value={c.text}>
                  {c.text} — {t('columns.recordStartCount', { n: c.count })}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {config.profile.kind === 'pdf-rows' && (
        <div className="max-w-xl">
          <Field label={t('columns.headerRow')} hint={t('columns.headerRowHint')}>
            <Select
              value={config.profile.tableAnchor ?? ''}
              disabled={busy}
              onChange={(e) => onSaveAnchor({ profile: { ...config.profile, tableAnchor: e.target.value } })}
            >
              <option value="">{t('columns.notMapped')}</option>
              {(columns.headerCandidates ?? []).map((c) => (
                <option key={c.anchor} value={c.anchor}>
                  {c.preview}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}

      {/*
        La mora, primero y aparte. No es una fila más: es la columna que decide quién aparece en
        mora, y en `pdf-blocks` elegirla mal no da ningún error — entra toda la cartera con cero
        días de atraso y la pantalla igual diría «Confirmada».
      */}
      <div
        className={`rounded-xl border p-5 ${
          days?.calibrated ? 'border-k-border bg-k-bg' : 'border-k-danger-bg bg-k-danger-bg/40'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold text-k-navy">{t('columns.calibrate')}</h3>
          <Badge tone={days?.calibrated ? 'success' : 'danger'} dot>
            {days?.calibrated ? t('columns.calibrated') : t('columns.required')}
          </Badge>
        </div>
        <p className="mt-1 text-[13px] text-k-text-2">{t('columns.calibrateHint')}</p>

        <div className="mt-4 grid gap-5 lg:grid-cols-2">
          <div className="min-w-0">
            <Field label={t('columns.moraQuestion')}>
              <Select
                value={days?.from ?? ''}
                disabled={busy}
                onChange={(e) =>
                  // Estas candidatas salen del CUADRO del extracto, así que en `pdf-blocks` van
                  // marcadas como columna de tabla. Sin eso el motor las busca en el encabezado del
                  // bloque, no las encuentra, y toda la cartera entra con cero días de atraso.
                  onSave(
                    pickDaysPastDue(days, e.target.value, config.profile.kind === 'pdf-blocks' ? 'table' : undefined),
                  )
                }
              >
                <option value="">{t('columns.notMapped')}</option>
                {/* La columna guardada puede no venir en ESTA muestra (un mes donde está vacía).
                    Sin ofrecerla, el control queda en blanco y la pantalla dice que la mora no está
                    emparejada cuando sí lo está. */}
                {(days?.from && !columns.columnCandidates.some((c) => c.header === days.from)
                  ? [days.from, ...columns.columnCandidates.map((c) => c.header)]
                  : columns.columnCandidates.map((c) => c.header)
                ).map((header) => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </Select>
            </Field>
            {columns.columnCandidates.length === 0 && (
              <p className="mt-2 text-[13px] text-k-text-2">{t('columns.noCandidates')}</p>
            )}

            {/* Los valores de verdad de la columna elegida, con el cliente al lado. Sólo se pueden
                mostrar si la columna vino en esta muestra; el estado se muestra siempre. */}
            {candidate && (
              <table className="mt-4 w-full text-[13px]">
                <thead>
                  <tr className="border-b border-k-border text-left text-[12px] uppercase tracking-wide text-k-text-2">
                    <th scope="col" className="pb-2 font-semibold">
                      {t('columns.moraColClient')}
                    </th>
                    <th scope="col" className="pb-2 text-right font-semibold">
                      {t('columns.moraColDays')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {candidate.samples.map((s, i) => (
                    <tr key={`${s.label}-${i}`} className="border-b border-k-border last:border-0">
                      <td className="truncate py-2 pr-4 text-k-text">{s.label}</td>
                      <td className="py-2 text-right font-medium tabular-nums text-k-danger">{s.value ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/*
            El botón de confirmar, al lado de los números y no antes. Son DOS llamadas a propósito
            (`CALIBRATION_STALE`): si elegir confirmara, «confirmado» no significaría nada — nadie
            habría visto estos valores.
          */}
          {days?.from && (
            <div className="self-start rounded-xl border border-k-border bg-white p-4">
              {days.calibrated ? (
                <>
                  <p className="text-[14px] font-medium text-k-success">{t('columns.calibrated')}</p>
                  <p className="mt-1 text-[13px] text-k-text-2">{t('columns.calibratedHint')}</p>
                </>
              ) : (
                <>
                  <p className="text-[14px] font-medium text-k-text">{t('columns.moraCheck')}</p>
                  <p className="mt-1 text-[13px] text-k-text-2">{t('columns.moraCheckHint')}</p>
                  <div className="mt-4">
                    <Button disabled={busy} onClick={() => onSave(confirmDaysPastDue(days))}>
                      {t('columns.calibrateConfirm')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div>
        <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('columns.essential')}</p>
        <ul className="mt-2 rounded-xl border border-k-border">
          {essential.map((field) => (
            <RowWithName
              key={field}
              field={field}
              config={config}
              realName={realName}
              busy={busy}
              onSave={onSave}
            >
              {row(field)}
            </RowWithName>
          ))}
        </ul>
      </div>

      {extra.length > 0 && (
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{t('columns.extra')}</p>
          <ul className="mt-2 rounded-xl border border-k-border">{extra.map(row)}</ul>
        </div>
      )}

      {addable.length > 0 && (
        <div className="rounded-xl border border-dashed border-k-border p-4">
          <p className="text-[13px] font-medium text-k-text">{t('columns.add')}</p>
          <p className="mt-1 text-[13px] text-k-text-2">{t('columns.addHint')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {addable.map((field) => (
              <button
                key={field}
                type="button"
                disabled={busy}
                onClick={() => onSave({ fields: { [field]: { enabled: true, required: false } } })}
                className="rounded-lg border border-k-border bg-white px-3 py-2 text-[13px] text-k-text hover:border-k-periwinkle hover:bg-k-bg disabled:opacity-50"
              >
                <span aria-hidden className="mr-1 text-k-purple">
                  +
                </span>
                {screen.catalog[field]?.label ?? field}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * La fila del cliente arrastra consigo el corte del nombre.
 *
 * Sola en su propia tarjeta parecía otra configuración desconectada, y es la misma decisión: de
 * qué columna sale el nombre y cómo se parte. La vista previa sale de `previewName`, que es el
 * espejo del `splitName` de la API — si las dos previeran distinto, se elegiría una regla y se
 * obtendría otra.
 */
function RowWithName({
  field,
  config,
  realName,
  busy,
  onSave,
  children,
}: {
  field: string;
  config: ImportConfig;
  realName: string | null;
  busy: boolean;
  onSave: (patch: ImportConfigPatch) => void;
  children: React.ReactNode;
}) {
  const t = useTranslations('panel.import');
  if (field !== 'clientName' || !config.fields.clientName?.from) return <>{children}</>;

  return (
    <>
      {children}
      <li className="border-t border-k-border bg-k-bg px-4 py-4 sm:px-5">
        <p className="text-[13px] font-medium text-k-text">{t('columns.nameOrder')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <Segmented
            label={t('columns.nameOrder')}
            value={config.nameOrder}
            options={NAME_ORDERS.map((order) => ({ value: order, label: t(`nameOrder.${order}`) }))}
            onChange={(nameOrder) => onSave({ nameOrder })}
          />
          <p className="min-w-0 text-[12px] text-k-text-2">
            {realName
              ? t('columns.namePreview', previewName(realName, config.nameOrder))
              : t('columns.namePreviewNone')}
          </p>
        </div>
        {busy && <span className="sr-only">{t('setup.saving')}</span>}
      </li>
    </>
  );
}
