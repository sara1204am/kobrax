'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CREDIT_STATUSES,
  DEFAULT_REPORT_STALE_AFTER_DAYS,
  REPORT_STALE_AFTER_DAYS_MAX,
  REPORT_STALE_AFTER_DAYS_MIN,
  type ImportConfig,
  type ImportConfigPatch,
} from '@kobrax/shared';
import { Button, Field, Input, Select } from '@/components/ui';
import { parseStaleAfterDays, removeStatusMapEntry, setStatusMapEntry } from '@/lib/import';

const BASES = ['principal', 'total'] as const;

/**
 * Cómo se lee el reporte que no es una columna: **qué es el saldo**, **qué estado de crédito es cada etiqueta**
 * que trae el archivo y **cuántos días vale el dato** antes de marcarlo viejo.
 *
 * Las validaciones son las del servidor (la base, el rango de días y que el estado exista): acá sólo se evita
 * mandar lo que se sabe que rebota, y lo demás lo dice el error que vuelve. Todo se guarda al momento, como el
 * resto de Ajustes.
 */
export function ReportStep({
  config,
  busy,
  onSave,
}: {
  config: ImportConfig;
  busy: boolean;
  onSave: (patch: ImportConfigPatch) => void;
}) {
  const t = useTranslations('panel.import.report');
  const tStatus = useTranslations('portfolio.creditStatus');

  return (
    <div className="space-y-8">
      <div className="max-w-md">
        <Field label={t('basis')} hint={t('basisHint')}>
          <Select
            value={config.balanceBasis ?? ''}
            disabled={busy}
            onChange={(e) => e.target.value && onSave({ balanceBasis: e.target.value as 'principal' | 'total' })}
          >
            {/* Sin definir no es una opción que se pueda guardar: el servidor no sabe quitarla. */}
            {!config.balanceBasis && (
              <option value="" disabled>
                {t('basisUnset')}
              </option>
            )}
            {BASES.map((b) => (
              <option key={b} value={b}>
                {t(`basisOptions.${b}`)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <StaleDays value={config.staleAfterDays} busy={busy} onSave={(staleAfterDays) => onSave({ staleAfterDays })} />

      <StatusMapEditor
        map={config.statusMap}
        busy={busy}
        statusLabel={(s) => tStatus(s as (typeof CREDIT_STATUSES)[number])}
        onSave={(statusMap) => onSave({ statusMap })}
      />
    </div>
  );
}

/** Días hasta marcar el dato como viejo. Se guarda al salir del campo, y sólo si es un entero dentro del rango. */
function StaleDays({ value, busy, onSave }: { value: number | undefined; busy: boolean; onSave: (days: number) => void }) {
  const t = useTranslations('panel.import.report');
  const current = value ?? DEFAULT_REPORT_STALE_AFTER_DAYS;
  const [draft, setDraft] = useState(String(current));
  const [invalid, setInvalid] = useState(false);

  function commit() {
    const parsed = parseStaleAfterDays(draft);
    if (!parsed.ok) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (parsed.value !== value) onSave(parsed.value);
  }

  return (
    <div className="max-w-md">
      <Field
        label={t('stale')}
        hint={t('staleHint', { min: REPORT_STALE_AFTER_DAYS_MIN, max: REPORT_STALE_AFTER_DAYS_MAX, def: DEFAULT_REPORT_STALE_AFTER_DAYS })}
      >
        <Input
          inputMode="numeric"
          value={draft}
          disabled={busy}
          error={invalid}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
      </Field>
      {invalid && (
        <p role="alert" className="mt-2 text-[12px] text-k-danger">
          {t('staleError', { min: REPORT_STALE_AFTER_DAYS_MIN, max: REPORT_STALE_AFTER_DAYS_MAX })}
        </p>
      )}
    </div>
  );
}

/** Etiqueta del reporte → estado del crédito. Cada cambio guarda el mapa entero (el `PATCH` lo reemplaza). */
function StatusMapEditor({
  map,
  busy,
  statusLabel,
  onSave,
}: {
  map: Record<string, string> | undefined;
  busy: boolean;
  statusLabel: (status: string) => string;
  onSave: (map: Record<string, string>) => void;
}) {
  const t = useTranslations('panel.import.report');
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<string>(CREDIT_STATUSES[0]);
  const [error, setError] = useState<string | null>(null);
  const entries = Object.entries(map ?? {}).sort(([a], [b]) => a.localeCompare(b));

  function add() {
    const result = setStatusMapEntry(map, label, status);
    if (!result.ok) {
      setError(t(`statusMapErrors.${result.reason}`));
      return;
    }
    setError(null);
    setLabel('');
    onSave(result.map);
  }

  return (
    <div>
      <p className="text-[14px] font-medium text-k-text">{t('statusMap')}</p>
      <p className="mt-1 text-[13px] text-k-text-2">{t('statusMapHint')}</p>

      {entries.length === 0 ? (
        <p className="mt-3 text-[13px] text-k-muted">{t('statusMapEmpty')}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {entries.map(([key, value]) => (
            <li key={key} className="flex flex-wrap items-center gap-3">
              <span className="min-w-[8rem] flex-1 truncate rounded-lg bg-k-bg px-3 py-2 text-[13px] font-medium text-k-text">{key}</span>
              <span aria-hidden className="text-k-muted">
                →
              </span>
              <Select
                aria-label={t('statusOf', { label: key })}
                value={value}
                disabled={busy}
                onChange={(e) => {
                  const result = setStatusMapEntry(map, key, e.target.value, key);
                  if (result.ok) onSave(result.map);
                }}
                className="!h-10 w-auto min-w-[10rem] flex-1 sm:flex-none"
              >
                {CREDIT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {statusLabel(s)}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                disabled={busy}
                aria-label={t('remove', { label: key })}
                onClick={() => onSave(removeStatusMapEntry(map, key))}
                className="rounded-lg px-2 py-1 text-[13px] font-medium text-k-danger hover:underline disabled:opacity-60"
              >
                {t('removeCta')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="min-w-[10rem] flex-1">
          <Field label={t('newLabel')}>
            <Input
              value={label}
              disabled={busy}
              placeholder={t('newLabelPlaceholder')}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              className="!h-10"
            />
          </Field>
        </div>
        <div className="min-w-[10rem]">
          <Field label={t('newStatus')}>
            <Select value={status} disabled={busy} onChange={(e) => setStatus(e.target.value)} className="!h-10">
              {CREDIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button variant="ghost" disabled={busy} onClick={add} className="!h-10 sm:w-auto sm:px-5">
          {t('add')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-k-danger">
          {error}
        </p>
      )}
    </div>
  );
}
