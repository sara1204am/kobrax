'use client';

import { useTranslations } from 'next-intl';
import { PAYER_PARTIES, reasonsFor } from '@kobrax/shared';
import type { CatalogOption } from '@/components/client-form';
import { Field, Input, Select } from '@/components/ui';
import { todayIso } from '@/lib/format';

/** Lo que se captura en el bloque «Motivo y quién responde» (F4/13 · E4). Todo es texto: vacío = no se eligió. */
export interface ActivityContext {
  reasonCode: string;
  expectedIncomeDate: string;
  payerParty: string;
}

export const emptyActivityContext = (): ActivityContext => ({ reasonCode: '', expectedIncomeDate: '', payerParty: '' });

/** ¿El motivo elegido pide la fecha en que el cliente espera cobrar? Lo dice el `metadata` del catálogo. */
export function asksIncomeDate(reasons: CatalogOption[], reasonCode: string): boolean {
  return reasons.find((r) => r.code === reasonCode)?.metadata?.asksExpectedIncomeDate === true;
}

/**
 * Lo que viaja a la API: **sólo lo que se eligió**. La fecha esperada sólo va si hay motivo y el motivo la pide; con
 * otro motivo se descarta aunque haya quedado escrita (la API la rechazaría con `EXPECTED_INCOME_DATE_NEEDS_REASON`).
 */
export function activityContextPayload(
  ctx: ActivityContext,
  reasons: CatalogOption[],
): { reasonCode?: string; expectedIncomeDate?: string; payerParty?: string } {
  return {
    ...(ctx.reasonCode ? { reasonCode: ctx.reasonCode } : {}),
    ...(ctx.reasonCode && ctx.expectedIncomeDate && asksIncomeDate(reasons, ctx.reasonCode) ? { expectedIncomeDate: ctx.expectedIncomeDate } : {}),
    ...(ctx.payerParty ? { payerParty: ctx.payerParty } : {}),
  };
}

/**
 * El bloque «Motivo y quién responde», el mismo de la ficha de mora (`activity-form.tsx`) para las otras dos vías que
 * registran una gestión: completar una agendada y la visita de una ruta (F4/13 · alineación web ↔ móvil).
 *
 * **Opcional**: dejarlo en blanco no es un error. Los motivos que se ofrecen dependen de la fuente de ingreso del
 * cliente (`incomeSource`); sin ella se ofrecen todos. Sin catálogo no se pinta nada: el que lo monta decide si aplica.
 */
export function ActivityContextFields({
  reasons,
  incomeSource,
  value,
  onChange,
  disabled,
  compact = false,
}: {
  reasons: CatalogOption[];
  incomeSource?: string;
  value: ActivityContext;
  onChange: (next: ActivityContext) => void;
  disabled?: boolean;
  /** El estilo de los formularios que no usan `@/components/ui` (el diálogo de la visita de ruta). */
  compact?: boolean;
}) {
  const tf = useTranslations('panel.mora.ficha.activity');
  const options = reasonsFor(reasons, incomeSource);
  const selected = reasons.find((r) => r.code === value.reasonCode);
  const asksDate = selected?.metadata?.asksExpectedIncomeDate === true;
  const set = (patch: Partial<ActivityContext>) => onChange({ ...value, ...patch });

  const reasonSelect = (
    <Select value={value.reasonCode} onChange={(e) => set({ reasonCode: e.target.value })} disabled={disabled}>
      <option value="">{tf('reasonPlaceholder')}</option>
      {options.map((r) => (
        <option key={r.code} value={r.code}>
          {r.label}
        </option>
      ))}
    </Select>
  );
  const suggestion = typeof selected?.metadata?.suggestion === 'string' ? selected.metadata.suggestion : null;
  const dateInput = <Input type="date" min={todayIso()} value={value.expectedIncomeDate} onChange={(e) => set({ expectedIncomeDate: e.target.value })} disabled={disabled} />;
  const payerSelect = (
    <Select value={value.payerParty} onChange={(e) => set({ payerParty: e.target.value })} disabled={disabled}>
      <option value="">{tf('payerPlaceholder')}</option>
      {PAYER_PARTIES.map((p) => (
        <option key={p} value={p}>
          {tf(`payers.${p}`)}
        </option>
      ))}
    </Select>
  );

  return (
    <fieldset className={`rounded-xl border border-k-border bg-k-bg p-3 ${compact ? 'space-y-3' : 'space-y-4'}`}>
      <legend className="px-1 text-[12px] font-semibold uppercase tracking-wide text-k-text-2">{tf('context')}</legend>
      <p className="text-[12px] text-k-muted">{tf('contextHint')}</p>
      <Field label={tf('reason')}>{reasonSelect}</Field>
      {suggestion && <p className="text-[12px] text-k-text-2">{suggestion}</p>}
      {asksDate && <Field label={tf('expectedIncome')}>{dateInput}</Field>}
      <Field label={tf('payer')}>{payerSelect}</Field>
    </fieldset>
  );
}
