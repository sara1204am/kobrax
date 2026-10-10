'use client';

import { useTranslations } from 'next-intl';
import {
  COLLECTION_FREQUENCIES,
  COLLECTION_NOTE_MAX_LENGTH,
  HANDOVER_PARTIES,
  collectionFormError,
  type CollectionProfileForm,
} from '@kobrax/shared';
import { Field, Input, Select } from '@/components/ui';
import type { CatalogOption } from '@/components/client-form';

/** Lunes a domingo, ISO (1–7): la misma numeración que valida `shared`. */
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * «Cómo conviene cobrarle» en un lugar (F4/13 · E2): cobrar todos los días en el negocio, recoger la cuota porque no
 * tiene tiempo, la franja, quién entrega. Es información que hoy vive en la memoria del cobrador.
 *
 * Solo se pinta: qué es válido y qué se manda lo deciden `collection-profile.ts` y `buildClientePayload`, en `shared`.
 * Todo es opcional; dejarlo en blanco no es un error.
 *
 * `modalities` viene del catálogo `COLLECTION_MODALITY` de la cuenta. Con el catálogo vacío no se dibuja el selector
 * (una modalidad es un código, no texto libre) y lo demás sigue funcionando.
 */
export function CollectionFields({
  value,
  onChange,
  modalities,
  disabled,
}: {
  value: CollectionProfileForm;
  onChange: (next: CollectionProfileForm) => void;
  modalities: CatalogOption[];
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<CollectionProfileForm>) => onChange({ ...value, ...patch });
  const error = collectionFormError(value);

  // Conserva una modalidad ya guardada que la cuenta sacó del catálogo: mostrarla vacía y guardar la borraría.
  const options = value.modality && !modalities.some((m) => m.code === value.modality)
    ? [...modalities, { code: value.modality, label: value.modality }]
    : modalities;

  const toggleDay = (d: number) => set({ days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b) });

  return (
    <fieldset className="mt-4 rounded-lg border border-k-border bg-white p-4" disabled={disabled}>
      <legend className="px-1 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('collection.title')}</legend>
      <p className="mb-3 text-[12px] text-k-muted">{t('collection.hint')}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        {options.length > 0 && (
          <Field label={t('collection.modality')}>
            <Select value={value.modality} onChange={(e) => set({ modality: e.target.value })}>
              <option value="">{t('collection.unset')}</option>
              {options.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('collection.frequency')}>
          <Select value={value.frequency} onChange={(e) => set({ frequency: e.target.value })}>
            <option value="">{t('collection.unset')}</option>
            {COLLECTION_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {t(`collection.frequencyOptions.${f}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('collection.windowFrom')}>
          <Input type="time" value={value.windowFrom} onChange={(e) => set({ windowFrom: e.target.value })} error={error === 'WINDOW_INVALID'} />
        </Field>
        <Field label={t('collection.windowTo')}>
          <Input type="time" value={value.windowTo} onChange={(e) => set({ windowTo: e.target.value })} error={error === 'WINDOW_INVALID'} />
        </Field>

        <Field label={t('collection.handoverBy')}>
          <Select value={value.handoverBy} onChange={(e) => set({ handoverBy: e.target.value })}>
            <option value="">{t('collection.unset')}</option>
            {HANDOVER_PARTIES.map((h) => (
              <option key={h} value={h}>
                {t(`collection.handoverOptions.${h}`)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="sm:col-span-2">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('collection.days')}</span>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('collection.days')}>
            {WEEK_DAYS.map((d) => {
              const on = value.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(d)}
                  className={`h-9 min-w-9 rounded-lg border px-2 text-[13px] font-medium transition ${on ? 'border-k-purple bg-k-highlight text-k-navy' : 'border-k-border bg-white text-k-text-2'}`}
                >
                  {t(`collection.dayShort.${d}`)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="sm:col-span-2">
          <Field label={t('collection.note')}>
            <Input value={value.note} maxLength={COLLECTION_NOTE_MAX_LENGTH} onChange={(e) => set({ note: e.target.value })} placeholder={t('collection.notePlaceholder')} />
          </Field>
        </div>
      </div>

      {error === 'WINDOW_INVALID' && (
        <p role="alert" className="mt-3 text-[12px] text-k-danger">
          {t('collection.errors.window')}
        </p>
      )}
    </fieldset>
  );
}
