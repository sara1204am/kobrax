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
import { WEEK_DAYS, WeekDayChips } from '@/components/week-day-chips';


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

  const daily = value.frequency === 'DAILY';
  const weekly = value.frequency === 'WEEKLY';
  const byCalendar = value.frequency === 'PER_INSTALLMENT';
  // «Todos los días»: los siete, marcados y sin poder cambiarse. Un perfil guardado antes con menos días se ve completo.
  const shownDays = daily ? [...WEEK_DAYS] : value.days;

  /** Cambiar la frecuencia ajusta los días: diaria los marca todos; semanal deja uno solo (el primero que hubiera). */
  const setFrequency = (frequency: string) => {
    if (frequency === 'DAILY') return set({ frequency, days: [...WEEK_DAYS] });
    if (frequency === 'WEEKLY') return set({ frequency, days: value.days.length > 0 && value.days.length < 7 ? [value.days[0]!] : [] });
    // Según el calendario de cuotas: no hay días que elegir (los da el calendario), así que se vacían.
    if (frequency === 'PER_INSTALLMENT') return set({ frequency, days: [] });
    set({ frequency });
  };
  const toggleDay = (d: number) => {
    if (daily) return;
    // Una vez por semana: un solo día. Tocar otro lo reemplaza; tocar el elegido no lo quita (es obligatorio).
    if (weekly) return set({ days: [d] });
    set({ days: value.days.includes(d) ? value.days.filter((x) => x !== d) : [...value.days, d].sort((a, b) => a - b) });
  };

  // Lo que se lee con la sección plegada.
  const dayShort = (d: number) => t(`collection.dayShort.${d}`);
  const summary = [
    options.find((m) => m.code === value.modality)?.label ?? (value.modality || null),
    value.frequency ? t(`collection.frequencyOptions.${value.frequency}`) : null,
    !daily && !byCalendar && shownDays.length > 0 ? shownDays.map(dayShort).join(' ') : null,
    value.windowFrom && value.windowTo ? `${value.windowFrom}–${value.windowTo}` : null,
    value.handoverBy ? t(`collection.handoverOptions.${value.handoverBy}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    /*
     * 🔴 `<details>` nativo, como las secciones del alta: se puede minimizar y maximizar sin JavaScript, y un campo obligatorio
     * dentro de uno plegado hace que el navegador lo abra para mostrar qué falta (no rebota el envío en silencio).
     */
    <details open className="group mt-4 rounded-lg border border-k-border bg-white">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 hover:bg-k-bg [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-k-muted transition-transform group-open:rotate-180">⌄</span>
        <span className="text-k-2xs font-semibold uppercase tracking-wide text-k-text-2">{t('collection.title')}</span>
        {summary && <span className="min-w-0 flex-1 truncate text-k-xs text-k-muted group-open:hidden">{summary}</span>}
      </summary>
      <fieldset className="border-t border-k-border p-4" disabled={disabled}>
        <p className="mb-3 text-k-xs text-k-muted">{t('collection.hint')}</p>

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

          {/* Frecuencia y días en UNA línea: lo que se elige en la primera decide lo que pasa en los segundos. */}
          <div className={`grid items-start gap-4 sm:col-span-2 ${byCalendar ? '' : 'sm:grid-cols-[minmax(0,15rem),1fr]'}`}>
            <Field label={t('collection.frequency')}>
              <Select value={value.frequency} onChange={(e) => setFrequency(e.target.value)}>
                <option value="">{t('collection.unset')}</option>
                {COLLECTION_FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {t(`collection.frequencyOptions.${f}`)}
                  </option>
                ))}
              </Select>
            </Field>

            {!byCalendar && (
            <div className="relative">
              <span className="mb-2 block text-k-base font-medium text-k-text">
                {t('collection.days')}
                {weekly && <span aria-hidden className="ml-0.5 text-k-danger">*</span>}
              </span>
              <WeekDayChips days={shownDays} onToggle={toggleDay} disabled={daily} label={t('collection.days')} />
              {/* «Una vez por semana» exige un día. Es un campo de verdad para que el navegador frene el envío y diga dónde. */}
              {weekly && (
                <input
                  tabIndex={-1}
                  aria-hidden
                  required
                  value={value.days.length > 0 ? 'ok' : ''}
                  onChange={() => undefined}
                  className="pointer-events-none absolute bottom-0 left-0 h-px w-px opacity-0"
                />
              )}
              <p className="mt-1.5 text-k-xs text-k-muted">
                {daily ? t('collection.daysDaily') : weekly ? t('collection.daysWeekly') : t('collection.daysFree')}
              </p>
            </div>
            )}
          </div>

          <Field label={t('collection.windowFrom')}>
            <Input type="time" value={value.windowFrom} onChange={(e) => set({ windowFrom: e.target.value })} error={error === 'WINDOW_INVALID'} />
          </Field>
          <Field label={t('collection.windowTo')}>
            <Input type="time" value={value.windowTo} onChange={(e) => set({ windowTo: e.target.value })} error={error === 'WINDOW_INVALID'} />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t('collection.note')}>
              <Input value={value.note} maxLength={COLLECTION_NOTE_MAX_LENGTH} onChange={(e) => set({ note: e.target.value })} placeholder={t('collection.notePlaceholder')} />
            </Field>
          </div>
        </div>

        {error === 'WINDOW_INVALID' && (
          <p role="alert" className="mt-3 text-k-xs text-k-danger">
            {t('collection.errors.window')}
          </p>
        )}
      </fieldset>
    </details>
  );
}
