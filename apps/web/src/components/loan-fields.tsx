'use client';

import { useTranslations } from 'next-intl';
import {
  InterestBase,
  PaymentFrequency,
  currentInstallment,
  quoteFor,
  totalBelowCapital,
  type PrestamoForm,
} from '@kobrax/shared';
import { Field, Input, Select } from '@/components/ui';
import { money } from '@/lib/format';

/**
 * Los campos del préstamo — **los mismos para darlo de alta y para corregirlo**.
 *
 * 🔴 **Existe porque las dos pantallas se habían separado.** El alta preguntaba capital, interés,
 * modo y cuota; la ficha mostraba capital y tasa **de sólo lectura**, diciendo en un comentario que
 * «la API no lo acepta en su DTO» — y sí lo aceptaba. Resultado: un préstamo con el capital mal
 * tipeado no tenía arreglo desde ninguna pantalla, y las dos se veían como productos distintos.
 *
 * 🔴 **La cotización no se escribe acá.** `quoteFor`, `currentInstallment` y `totalBelowCapital`
 * viven en `@kobrax/shared` y son **las mismas** que usa el teléfono. Es plata: si el escritorio
 * calculara distinto, la diferencia aparecería meses después en la boca de un cliente.
 *
 * Dos modos, como en el móvil: **A** con la cuota tipeada (quien carga ya la sabe) y **B**
 * calculándola desde el interés. En B la cuota sigue siendo editable, para redondearla — y al
 * editarla, el cálculo deja de pisarla.
 */
export function LoanFields({
  form,
  onChange,
  disabled,
  /**
   * El nº de cuotas sólo se elige al dar de alta.
   *
   * 🔴 Cambiarlo después **no lo acepta la API**, y con razón: sin regenerar el cronograma quedaría
   * una tabla de cuotas que no cierra con el préstamo. Acá se muestra igual —el cálculo lo necesita
   * y quien mira quiere verlo—, apagado.
   */
  installmentsCountEditable = true,
}: {
  form: PrestamoForm;
  onChange: (next: PrestamoForm) => void;
  disabled?: boolean;
  installmentsCountEditable?: boolean;
}) {
  const t = useTranslations('portfolio');
  const set = (patch: Partial<PrestamoForm>) => onChange({ ...form, ...patch });

  return (
    <>
      {/* El modo no es una preferencia: cambia de dónde sale la cuota. */}
      <div className="mb-5 flex gap-2">
        {(['A', 'B'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set({ mode: m })}
            disabled={disabled}
            aria-pressed={form.mode === m}
            className={`rounded-xl px-4 py-2 text-[14px] font-medium disabled:opacity-50 ${
              form.mode === m ? 'bg-k-navy text-white' : 'border border-k-border bg-white text-k-text-2 hover:bg-k-bg'
            }`}
          >
            {t(`loanMode.${m}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('fields.principal')}>
          <Input
            value={form.principal}
            onChange={(e) => set({ principal: e.target.value })}
            disabled={disabled}
            type="number"
            min={0}
            step="0.01"
            required
          />
        </Field>

        {form.mode === 'B' && (
          <>
            <Field label={t('form.interest')}>
              <Input
                value={form.interestPercent}
                onChange={(e) => set({ interestPercent: e.target.value })}
                disabled={disabled}
                type="number"
                min={0}
                step="0.01"
              />
            </Field>
            <Field label={t('form.interestBase')}>
              <Select value={form.base} onChange={(e) => set({ base: e.target.value as InterestBase })} disabled={disabled}>
                <option value={InterestBase.PER_PERIOD}>{t('interestBase.PER_PERIOD')}</option>
                <option value={InterestBase.TOTAL}>{t('interestBase.TOTAL')}</option>
              </Select>
            </Field>
          </>
        )}

        <Field label={t('fields.installment')}>
          <Input
            value={form.mode === 'B' && !form.installmentEdited ? String(currentInstallment(form) || '') : form.installment}
            // Editarla a mano en el modo B la congela: el cálculo deja de pisarla. Es para
            // redondear a un número que se pueda cobrar en billetes.
            onChange={(e) => set({ installment: e.target.value, installmentEdited: form.mode === 'B' })}
            disabled={disabled}
            type="number"
            min={0}
            step="0.01"
          />
        </Field>

        <Field label={t('form.installmentsCount')}>
          <Input
            value={form.installmentsCount}
            onChange={(e) => set({ installmentsCount: e.target.value })}
            disabled={disabled || !installmentsCountEditable}
            type="number"
            min={0}
            step="1"
            placeholder={t('form.openLoanHint')}
          />
        </Field>

        <Field label={t('fields.frequency')}>
          <Select value={form.frequency} onChange={(e) => set({ frequency: e.target.value as PaymentFrequency })} disabled={disabled}>
            {Object.values(PaymentFrequency).map((f) => (
              <option key={f} value={f}>
                {t(`frequency.${f}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('fields.nextDue')}>
          {/* `<input type="date">` nativo: no hace falta ninguna librería de calendario. */}
          <Input type="date" value={form.nextDueDate} onChange={(e) => set({ nextDueDate: e.target.value })} disabled={disabled} />
        </Field>
      </div>
    </>
  );
}

/** El panel en vivo. Sale de `shared`: los mismos tres números que muestra el teléfono. */
export function LoanQuotePanel({ form, currency }: { form: PrestamoForm; currency: string }) {
  const t = useTranslations('portfolio');
  const quote = quoteFor(form);

  return (
    <section className="rounded-2xl border border-k-border bg-k-highlight p-5">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Quote label={t('quote.installment')} value={money(quote.installment, currency)} big />
        <Quote label={t('quote.total')} value={money(quote.total, currency)} />
        <Quote label={t('quote.profit')} value={money(quote.profit, currency)} />
      </dl>
      {/* Aviso, no freno: hay préstamos que se dan así, y el cobrador sabrá. */}
      {totalBelowCapital(form) && <p className="mt-3 text-[13px] text-k-warning-text">{t('quote.belowCapital')}</p>}
    </section>
  );
}

function Quote({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className={`mt-0.5 font-semibold text-k-navy ${big ? 'text-[22px]' : 'text-[16px]'}`}>{value}</dd>
    </div>
  );
}
