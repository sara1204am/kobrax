'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CreditScheduleRow } from '@kobrax/shared';
import { Field, Select } from '@/components/ui';
import { dayDate } from '@/lib/format';

/**
 * «Cuotas ya pagadas antes de registrarlo» (D13): cuántas de las **primeras** cuotas ya se pagaron, de 0 a
 * n − 1 (un crédito no se registra con todas pagas). Lo usan el Nuevo crédito y Editar.
 *
 * Cada opción dice hasta qué cuota y su fecha («4 de 36 · 12 abr 2026»), y la de la cuota que vence este
 * mes va en negrita y marcada: es el corte más probable para un crédito que viene al día.
 * ⚠️ La negrita de un `<option>` sólo la respeta Firefox; por eso además dice «este mes».
 */
export function PaidInstallmentsSelect({
  schedule,
  value,
  onChange,
  today = new Date(),
}: {
  schedule: CreditScheduleRow[];
  value: number;
  onChange: (paid: number) => void;
  today?: Date;
}) {
  const t = useTranslations('portfolio.creditForm.paid');
  const locale = useLocale();
  // «Este mes» en la zona de quien mira: el mes civil de hoy, comparado con el YYYY-MM de la cuota.
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  return (
    <Field label={t('label')} hint={t('hint')}>
      <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="0">{t('none')}</option>
        {schedule.slice(0, -1).map((row) => {
          const current = row.dueDate.slice(0, 7) === thisMonth;
          return (
            <option key={row.number} value={row.number} style={current ? { fontWeight: 700 } : undefined}>
              {t('option', { count: row.number, total: schedule.length, date: dayDate(row.dueDate, locale) })}
              {current ? ` · ${t('thisMonth')}` : ''}
            </option>
          );
        })}
      </Select>
    </Field>
  );
}
