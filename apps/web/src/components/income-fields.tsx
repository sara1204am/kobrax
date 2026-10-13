'use client';

import { useTranslations } from 'next-intl';
import {
  INCOME_CYCLES,
  INCOME_NOTES_MAX_LENGTH,
  INCOME_SOURCE_CODES,
  cycleHasDay,
  dayRangeOf,
  incomeFormError,
  type IncomeProfileForm,
} from '@kobrax/shared';
import { Field, Input, Select } from '@/components/ui';
import type { CatalogOption } from '@/components/client-form';

/**
 * De qué vive y cuándo le llega el dinero (F4/13 · E3): fuente de ingreso, rubro, ciclo y día.
 *
 * Solo pinta: qué es válido y qué se manda lo deciden `income-profile.ts` y `buildClientePayload`, en `shared`. Todo es
 * opcional; dejarlo en blanco no es un error.
 *
 * Dos comodidades que no obligan a nada:
 *  - al elegir un rubro, si todavía no hay fuente o ciclo, se **proponen** los del rubro (`metadata.incomeSource` y
 *    `metadata.defaultCycle`); la persona los puede cambiar;
 *  - el rubro se filtra por la fuente elegida, pero si la fuente no se conoce se ofrecen todos.
 */
export function IncomeFields({
  value,
  onChange,
  sources,
  occupations,
  disabled,
}: {
  value: IncomeProfileForm;
  onChange: (next: IncomeProfileForm) => void;
  /** Catálogo `INCOME_SOURCE`. Vacío = se ofrecen los tres códigos fijos con su texto por defecto. */
  sources: CatalogOption[];
  /** Catálogo `OCCUPATION`. Vacío = no se dibuja el selector de rubro. */
  occupations: CatalogOption[];
  disabled?: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<IncomeProfileForm>) => onChange({ ...value, ...patch });
  const error = incomeFormError(value);
  const range = dayRangeOf(value.incomeCycle);

  const sourceOptions: CatalogOption[] =
    sources.length > 0 ? sources : INCOME_SOURCE_CODES.map((code) => ({ code, label: t(`income.sourceDefault.${code}`) }));

  // El rubro se filtra por la fuente, pero **conserva el ya guardado** aunque la cuenta lo haya sacado del catálogo.
  const visibleOccupations = value.incomeSourceCode
    ? occupations.filter((o) => !o.metadata?.incomeSource || o.metadata.incomeSource === value.incomeSourceCode || o.code === value.occupationCode)
    : occupations;
  const occupationOptions =
    value.occupationCode && !visibleOccupations.some((o) => o.code === value.occupationCode)
      ? [...visibleOccupations, { code: value.occupationCode, label: value.occupationCode }]
      : visibleOccupations;

  function pickOccupation(code: string) {
    const meta = occupations.find((o) => o.code === code)?.metadata ?? {};
    const patch: Partial<IncomeProfileForm> = { occupationCode: code };
    if (code && !value.incomeSourceCode && typeof meta.incomeSource === 'string') patch.incomeSourceCode = meta.incomeSource;
    if (code && !value.incomeCycle && typeof meta.defaultCycle === 'string') patch.incomeCycle = meta.defaultCycle;
    set(patch);
  }

  function pickCycle(cycle: string) {
    // El día que ya no corresponde se va con el ciclo: un «15» huérfano en «diario» lo rechazaría el servidor.
    set({ incomeCycle: cycle, ...(cycleHasDay(cycle) ? {} : { incomeDay: '' }) });
  }

  return (
    <div className="space-y-4">
      <p className="text-[12px] text-k-muted">{t('income.hint')}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('income.source')}>
          <Select value={value.incomeSourceCode} onChange={(e) => set({ incomeSourceCode: e.target.value })} disabled={disabled}>
            <option value="">{t('income.unset')}</option>
            {sourceOptions.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>

        {occupations.length > 0 && (
          <Field label={t('income.occupation')}>
            <Select value={value.occupationCode} onChange={(e) => pickOccupation(e.target.value)} disabled={disabled}>
              <option value="">{t('income.unset')}</option>
              {occupationOptions.map((o) => (
                <option key={o.code} value={o.code}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field label={t('income.cycle')}>
          <Select value={value.incomeCycle} onChange={(e) => pickCycle(e.target.value)} disabled={disabled}>
            <option value="">{t('income.unset')}</option>
            {INCOME_CYCLES.map((c) => (
              <option key={c} value={c}>
                {t(`income.cycleOptions.${c}`)}
              </option>
            ))}
          </Select>
        </Field>

        {range && (
          <Field label={value.incomeCycle === 'WEEKLY' ? t('income.dayOfWeek') : t('income.dayOfMonth')}>
            {value.incomeCycle === 'WEEKLY' ? (
              <Select value={value.incomeDay} onChange={(e) => set({ incomeDay: e.target.value })} disabled={disabled}>
                <option value="">{t('income.unset')}</option>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={String(d)}>
                    {t(`income.weekdays.${d}`)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                type="number"
                min={range[0]}
                max={range[1]}
                inputMode="numeric"
                value={value.incomeDay}
                onChange={(e) => set({ incomeDay: e.target.value })}
                disabled={disabled}
                error={error === 'DAY_INVALID'}
              />
            )}
          </Field>
        )}

        <div className="sm:col-span-2">
          <Field label={t('income.notes')}>
            <Input
              value={value.notes}
              maxLength={INCOME_NOTES_MAX_LENGTH}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder={t('income.notesPlaceholder')}
              disabled={disabled}
            />
          </Field>
        </div>
      </div>

      {error === 'DAY_INVALID' && (
        <p role="alert" className="text-[12px] text-k-danger">
          {t('income.errors.day')}
        </p>
      )}
    </div>
  );
}
