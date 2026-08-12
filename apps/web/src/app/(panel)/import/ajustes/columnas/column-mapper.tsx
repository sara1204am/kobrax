'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  applyFieldState,
  fieldState,
  previewName,
  type ColumnsPayload,
  type ConfigScreen,
  type FieldRule,
  type FieldState,
  type ImportConfig,
  type ImportConfigPatch,
  type NameOrder,
} from '@kobrax/shared';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { DataTable } from '@/components/data-table';
import { Card, EmptyState, Hint } from '@/components/panel-ui';
import { useToast } from '@/components/toast';
import {
  ACCEPTED_FILES,
  DAYS_PAST_DUE,
  confirmDaysPastDue,
  errorText,
  patchConfig,
  pickDaysPastDue,
  postImportFile,
} from '@/lib/import';

const FIELD_STATES: FieldState[] = ['required', 'optional', 'off'];
const NAME_ORDERS: NameOrder[] = ['full', 'surnames-first', 'split-columns'];

/**
 * Emparejar columnas.
 *
 * Hace configurable un formato que nunca vimos: la persona sube SU archivo, la API le dice qué
 * etiquetas encontró (`?columnsOnly=true`, que no importa nada) y acá se dice qué alimenta qué.
 */
export function ColumnMapper({ screen }: { screen: ConfigScreen }) {
  const t = useTranslations('panel.import');
  const locale = useLocale();
  const toast = useToast();
  const filePicker = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<ImportConfig>(screen.config);
  const [columns, setColumns] = useState<ColumnsPayload | null>(null);
  // Se guarda el `File`, no su nombre: al fijar el ancla del PDF hay que volver a leerlo, y
  // pedirle a la persona que lo busque de nuevo en el disco la deja trabada.
  const [sample, setSample] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(patch: ImportConfigPatch): Promise<boolean> {
    setError(null);
    setBusy(true);
    const result = await patchConfig(patch);
    setBusy(false);
    if (!result.ok || !result.config) {
      setError(errorText(result.error, t, locale) || t('settings.saveError'));
      return false;
    }
    setConfig(result.config);
    toast(t('settings.saved'));
    return true;
  }

  async function readSample(file: File) {
    setError(null);
    setBusy(true);
    const result = await postImportFile<ColumnsPayload>(file, { columnsOnly: true });
    setBusy(false);
    if (!result.ok || !result.data) {
      setError(errorText(result.error, t, locale));
      return;
    }
    setColumns(result.data);
    setSample(file);
  }

  /**
   * Guardar dónde arranca la tabla y **volver a leer la muestra con eso puesto**.
   *
   * Sin el ancla, el motor de PDF no encuentra la tabla y devuelve `labels: []`. Guardar y no
   * releer dejaba todos los «Sale de» ofreciendo sólo «Sin emparejar» para siempre, sin nada que
   * indicara que había que volver a subir el archivo — y ésta es la pantalla que habilita el
   * módulo entero.
   */
  async function saveAnchor(patch: ImportConfigPatch) {
    if ((await save(patch)) && sample) await readSample(sample);
  }

  const labels = columns?.labels ?? [];
  const days = config.fields[DAYS_PAST_DUE];
  const candidate = columns?.columnCandidates.find((c) => c.header === days?.from);
  // Un nombre REAL del archivo: es lo único que deja elegir el corte sin adivinar. La API lo manda
  // como rótulo de cada muestra de columna.
  const realName = columns?.columnCandidates[0]?.samples.find((s) => s.label)?.label ?? null;

  const missing = Object.keys(screen.catalog).filter((field) => !config.fields[field]);
  const mapped = Object.entries(config.fields);

  return (
    <div className="space-y-6">
      <ErrorBanner message={error} />

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-k-text">{t('columns.sample')}</p>
            <p className="mt-1 truncate text-[13px] text-k-text-2">
              {busy && !columns ? t('columns.reading') : (sample?.name ?? t('columns.noSampleText'))}
            </p>
          </div>
          <input
            ref={filePicker}
            type="file"
            accept={ACCEPTED_FILES}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // El input se limpia para que elegir el MISMO archivo otra vez vuelva a disparar
              // `change` — si no, reintentar después de un error no hace nada.
              e.target.value = '';
              if (file) void readSample(file);
            }}
          />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => filePicker.current?.click()}
            className="sm:w-auto sm:px-5"
          >
            {sample ? t('columns.changeSample') : t('columns.pickSample')}
          </Button>
        </div>
      </Card>

      {!columns ? (
        <EmptyState
          title={t('columns.noSample')}
          text={t('columns.noSampleText')}
          action={
            <Link href="/import/ajustes" className="text-[14px] font-medium text-k-purple hover:underline">
              {t('settings.title')}
            </Link>
          }
        />
      ) : (
        <>
          {/* Cada forma de archivo trae su propia pregunta pendiente. Una planilla no tiene ninguna. */}
          {config.profile.kind === 'pdf-blocks' && (
            <Card>
              <Field label={t('columns.recordStart')}>
                <Select
                  value={config.profile.recordStart ?? ''}
                  disabled={busy}
                  onChange={(e) => saveAnchor({ profile: { ...config.profile, recordStart: e.target.value } })}
                >
                  <option value="">{t('columns.notMapped')}</option>
                  {(columns.recordStartCandidates ?? []).map((c) => (
                    <option key={c.text} value={c.text}>
                      {c.text} — {t('columns.recordStartCount', { n: c.count })}
                    </option>
                  ))}
                </Select>
              </Field>
              <Hint>{t('columns.recordStartHint')}</Hint>
            </Card>
          )}

          {config.profile.kind === 'pdf-rows' && (
            <Card>
              <Field label={t('columns.headerRow')}>
                <Select
                  value={config.profile.tableAnchor ?? ''}
                  disabled={busy}
                  onChange={(e) => saveAnchor({ profile: { ...config.profile, tableAnchor: e.target.value } })}
                >
                  <option value="">{t('columns.notMapped')}</option>
                  {(columns.headerCandidates ?? []).map((c) => (
                    <option key={c.anchor} value={c.anchor}>
                      {c.preview}
                    </option>
                  ))}
                </Select>
              </Field>
              <Hint>{t('columns.headerRowHint')}</Hint>
            </Card>
          )}

          <DataTable
            columns={[
              {
                key: 'field',
                header: t('columns.field'),
                // Ordenar navega con searchParams nuevos y remontaría la pantalla, perdiendo el
                // archivo de muestra que vive en el estado. Si algún día hace falta, se ordena
                // el array en cliente.
                sortable: false,
                render: ([field]: [string, FieldRule]) => (
                  <span className="font-medium text-k-text">{screen.catalog[field]?.label ?? field}</span>
                ),
              },
              {
                key: 'from',
                header: t('columns.from'),
                sortable: false,
                render: ([field, rule]: [string, FieldRule]) => (
                  <Select
                    aria-label={`${t('columns.from')} — ${screen.catalog[field]?.label ?? field}`}
                    value={rule.from ?? ''}
                    disabled={busy}
                    className="h-10 text-[14px]"
                    onChange={(e) =>
                      save(
                        // Acá las opciones son las etiquetas del archivo, no columnas del cuadro:
                        // `in` se limpia para que el motor las busque donde de verdad están.
                        field === DAYS_PAST_DUE
                          ? pickDaysPastDue(rule, e.target.value)
                          : { fields: { [field]: { ...rule, from: e.target.value || undefined, in: undefined } } },
                      )
                    }
                  >
                    {/*
                      Desemparejar un campo bloqueado pasa las dos validaciones —`code` no es
                      obligatorio por defecto— y deja el import sin llave: la corrida siguiente
                      rechaza el 100 % de las filas con `NO_CODE` mientras Ajustes se ve entero.
                      La opción se dibuja igual para que el select tenga qué mostrar si todavía no
                      está emparejado, pero no se puede elegir.
                    */}
                    <option value="" disabled={screen.catalog[field]?.locked}>
                      {t('columns.notMapped')}
                    </option>
                    {/* La columna guardada puede no estar en ESTA muestra: se ofrece igual, o
                        cambiar de muestra desemparejaría todo sin decirlo. */}
                    {(rule.from && !labels.includes(rule.from) ? [rule.from, ...labels] : labels).map((label) => (
                      <option key={label} value={label}>
                        {label}
                      </option>
                    ))}
                  </Select>
                ),
              },
              {
                key: 'state',
                header: t('columns.state'),
                sortable: false,
                render: ([field, rule]: [string, FieldRule]) =>
                  screen.catalog[field]?.locked ? (
                    <span className="text-[13px] text-k-text-2">{t('columns.locked')}</span>
                  ) : (
                    <Select
                      aria-label={`${t('columns.state')} — ${screen.catalog[field]?.label ?? field}`}
                      value={fieldState(rule)}
                      disabled={busy}
                      className="h-10 text-[14px]"
                      onChange={(e) =>
                        save({ fields: { [field]: applyFieldState(rule, e.target.value as FieldState) } })
                      }
                    >
                      {FIELD_STATES.map((state) => (
                        <option key={state} value={state}>
                          {t(`fieldStates.${state}.label`)}
                        </option>
                      ))}
                    </Select>
                  ),
              },
              {
                key: 'remove',
                header: '',
                sortable: false,
                render: ([field]: [string, FieldRule]) =>
                  screen.catalog[field]?.locked ? null : (
                    <button
                      type="button"
                      disabled={busy}
                      // `null` QUITA el campo del emparejado. Apagarlo lo deja en la lista; esto no.
                      onClick={() => save({ fields: { [field]: null } })}
                      className="text-[13px] font-medium text-k-danger hover:underline disabled:opacity-50"
                    >
                      {t('columns.remove')}
                    </button>
                  ),
              },
            ]}
            rows={mapped}
            rowKey={([field]) => field}
            meta={{ total: mapped.length, page: 1, limit: Math.max(mapped.length, 1), pages: 1 }}
            empty={<EmptyState title={t('columns.notMapped')} text={t('columns.subtitle')} />}
          />

          {missing.length > 0 && (
            <Card>
              <Field label={t('columns.add')}>
                <Select
                  value=""
                  disabled={busy}
                  onChange={(e) =>
                    e.target.value && save({ fields: { [e.target.value]: { enabled: true, required: false } } })
                  }
                >
                  <option value="">{t('columns.add')}</option>
                  {missing.map((field) => (
                    <option key={field} value={field}>
                      {screen.catalog[field]?.label ?? field}
                    </option>
                  ))}
                </Select>
              </Field>
            </Card>
          )}

          <Card>
            <Field label={t('columns.nameOrder')}>
              <Select
                value={config.nameOrder}
                disabled={busy}
                onChange={(e) => save({ nameOrder: e.target.value as NameOrder })}
              >
                {NAME_ORDERS.map((order) => (
                  <option key={order} value={order}>
                    {t(`nameOrder.${order}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Hint>
              {realName
                ? t('columns.namePreview', previewName(realName, config.nameOrder))
                : t('columns.namePreviewNone')}
            </Hint>
          </Card>

          <Card>
            <Field label={t('columns.calibrate')}>
              <Select
                value={days?.from ?? ''}
                disabled={busy}
                onChange={(e) =>
                  // Estas candidatas salen del CUADRO del extracto, así que en `pdf-blocks` van
                  // marcadas como columna de tabla. Sin eso el motor las busca en el encabezado
                  // del bloque, no las encuentra, y toda la cartera entra con cero días de atraso.
                  save(
                    pickDaysPastDue(
                      days,
                      e.target.value,
                      config.profile.kind === 'pdf-blocks' ? 'table' : undefined,
                    ),
                  )
                }
              >
                <option value="">{t('columns.notMapped')}</option>
                {/* La columna guardada puede no venir en ESTA muestra (un mes donde está vacía).
                    Sin ofrecerla, el control queda en blanco y la pantalla dice que la mora no
                    está emparejada cuando sí lo está. */}
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
            <Hint>{t('columns.calibrateHint')}</Hint>

            {columns.columnCandidates.length === 0 && <Hint>{t('columns.noCandidates')}</Hint>}

            {/*
              Los valores de verdad de la columna elegida, y recién debajo el botón de confirmar.
              Son DOS llamadas a propósito (`CALIBRATION_STALE`): si elegir confirmara, «confirmado»
              no significaría nada — nadie habría visto estos números.
            */}
            {days?.from && (
              <div className="mt-4 space-y-3">
                {/* Los valores sólo se pueden mostrar si la columna vino en esta muestra; el
                    estado de la calibración se muestra siempre, que es lo que la persona pregunta. */}
                {candidate && (
                  <ul className="space-y-1 rounded-xl bg-k-bg px-4 py-3 text-[13px] text-k-text">
                    {candidate.samples.map((s, i) => (
                      <li key={`${s.label}-${i}`} className="flex justify-between gap-4">
                        <span className="truncate text-k-text-2">{s.label}</span>
                        <span className="shrink-0 tabular-nums">{s.value ?? '—'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {days.calibrated ? (
                  <p className="text-[13px] font-medium text-k-success">{t('columns.calibrated')}</p>
                ) : (
                  <span className="block sm:w-auto">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => save(confirmDaysPastDue(days))}
                      className="sm:w-auto sm:px-5"
                    >
                      {t('columns.calibrateConfirm')}
                    </Button>
                  </span>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      <Link href="/import" className="inline-block text-[14px] font-medium text-k-purple hover:underline">
        {t('backToRun')}
      </Link>
    </div>
  );
}
