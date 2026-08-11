'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { PaymentFrequency, type CreditDetail } from '@kobrax/shared';
import { Badge, PageHeader } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { money, date } from '@/lib/format';
import { creditPatch, hasCreditChanges, type CreditForm } from '@/lib/credit-patch';

const select =
  'h-[52px] w-full rounded-xl border-[1.5px] border-k-light-bg bg-white px-3.5 text-[15px] text-k-text outline-none transition-all focus:border-k-periwinkle focus:shadow-k-focus disabled:opacity-60';

/**
 * La ficha del crédito: lo que no se toca, lo que sí, y el cronograma si existe.
 *
 * 🔴 **Puede no haber cronograma, y eso no es un error.** Un crédito dado de alta desde el móvil
 * lleva la cuota congelada en `metadata` y su próxima fecha es un dato, no una derivación: no tiene
 * cuotas que listar. Asumir que siempre hay una tabla es el bug que C14 avisa.
 *
 * Y si el crédito vino de un archivo o de otro core (`locked`), sus campos financieros no se
 * editan: la pantalla los apaga para no ofrecer lo que la API va a rechazar.
 */
export function CreditCard({ credit, clientId }: { credit: CreditDetail; clientId: string }) {
  const t = useTranslations('portfolio');
  const router = useRouter();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('credit:write') && !credit.locked;

  const [form, setForm] = useState<CreditForm>({
    installmentAmount: credit.installmentAmount != null ? String(credit.installmentAmount) : '',
    frequency: credit.frequency ?? PaymentFrequency.MONTHLY,
    nextDueDate: credit.nextDueDate ?? '',
    notes: credit.notes ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = creditPatch(credit, form);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const { ok, data } = await sendJson<CreditDetail>(`/api/credits/${credit.id}`, patch, 'PATCH');
    setSaving(false);
    if (!ok) {
      setError(data.error?.message ?? t('saveError'));
      return;
    }
    toast(t('saved'));
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title={money(credit.outstandingBalance, credit.currency)}
        subtitle={t('creditSubtitle', {
          principal: money(credit.principalAmount, credit.currency),
          code: credit.code ?? t('noCode'),
        })}
        actions={
          <>
            {credit.locked && <Badge tone="warning">{t('imported')}</Badge>}
            {(credit.daysPastDue ?? 0) > 0 && <Badge tone="danger">{t('days', { count: credit.daysPastDue! })}</Badge>}
            <Link href={`/cartera/${clientId}`} className="text-[13px] font-medium text-k-purple hover:underline">
              {t('backToClient')}
            </Link>
          </>
        }
      />

      <div className="space-y-4">
        {/* Lo que no se edita después del desembolso: cambiarlo es una reestructura, y la API
            directamente no lo acepta en su DTO. */}
        <section className="rounded-2xl border border-k-border bg-white p-5">
          <h2 className="mb-4 text-[16px] font-semibold text-k-navy">{t('sections.creditFixed')}</h2>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <Item label={t('fields.principal')} value={money(credit.principalAmount, credit.currency)} />
            <Item label={t('fields.rate')} value={`${credit.interestRate}`} />
            <Item label={t('fields.installments')} value={credit.installmentsCount ? String(credit.installmentsCount) : t('openLoan')} />
            <Item label={t('fields.currency')} value={credit.currency} />
            <Item label={t('fields.disbursedAt')} value={credit.disbursedAt ? date(credit.disbursedAt) : '—'} />
            <Item label={t('form.status')} value={credit.status ? t(`creditStatus.${credit.status}`) : '—'} />
          </dl>
        </section>

        <form onSubmit={save} className="space-y-5 rounded-2xl border border-k-border bg-white p-5">
          <h2 className="text-[16px] font-semibold text-k-navy">{t('sections.creditEditable')}</h2>
          <ErrorBanner message={error} />
          {credit.locked && <p className="text-[13px] text-k-warning-text">{t('lockedHint')}</p>}

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t('fields.installment')}>
              <Input
                value={form.installmentAmount}
                onChange={(e) => setForm({ ...form, installmentAmount: e.target.value })}
                disabled={!editable}
                inputMode="decimal"
              />
            </Field>
            <Field label={t('fields.frequency')}>
              <select
                value={form.frequency}
                onChange={(e) => setForm({ ...form, frequency: e.target.value as PaymentFrequency })}
                disabled={!editable}
                className={select}
              >
                {Object.values(PaymentFrequency).map((f) => (
                  <option key={f} value={f}>
                    {t(`frequency.${f}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('fields.nextDue')}>
              {/* `<input type="date">` nativo: no hace falta ninguna librería de calendario. */}
              <Input
                type="date"
                value={form.nextDueDate}
                onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}
                disabled={!editable}
              />
            </Field>
            <Field label={t('form.notes')}>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} disabled={!editable} maxLength={500} />
            </Field>
          </div>

          {editable && (
            <div className="flex justify-end">
              <span className="w-full sm:w-48">
                <Button type="submit" loading={saving} disabled={!hasCreditChanges(patch)}>
                  {t('save')}
                </Button>
              </span>
            </div>
          )}
        </form>

        <section className="rounded-2xl border border-k-border bg-white p-5">
          <h2 className="mb-4 text-[16px] font-semibold text-k-navy">{t('sections.schedule')}</h2>
          <Schedule credit={credit} />
        </section>
      </div>
    </>
  );
}

/**
 * El cronograma, o por qué no hay uno.
 *
 * Sin cuotas **no** se dibuja una tabla vacía: se explica que este crédito lleva la cuota
 * congelada, que es una forma de préstamo del producto y no un dato faltante.
 */
function Schedule({ credit }: { credit: CreditDetail }) {
  const t = useTranslations('portfolio');
  const rows = credit.installments ?? [];

  if (rows.length === 0) {
    return (
      <div>
        <p className="text-[14px] text-k-text-2">{t('noSchedule')}</p>
        <p className="mt-1 text-[12px] text-k-muted">
          {t('noScheduleHint', {
            amount: credit.installmentAmount != null ? money(credit.installmentAmount, credit.currency) : '—',
            date: credit.nextDueDate ? date(credit.nextDueDate) : '—',
          })}
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-k-border text-left text-[12px] font-semibold uppercase tracking-wide text-k-text-2">
            <th scope="col" className="py-2 pr-4">{t('schedule.number')}</th>
            <th scope="col" className="py-2 pr-4">{t('schedule.dueDate')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('schedule.amount')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('schedule.paid')}</th>
            <th scope="col" className="py-2">{t('columns.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="border-b border-k-border last:border-0">
              <td className="py-2 pr-4 text-k-text-2">{i.number}</td>
              <td className="py-2 pr-4">{date(i.dueDate)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(i.amount, credit.currency)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(i.paidAmount, credit.currency)}</td>
              <td className="py-2">
                <Badge tone={i.status === 'PAID' ? 'success' : i.status === 'OVERDUE' ? 'danger' : 'neutral'}>
                  {t(`installmentStatus.${i.status}`)}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-k-text">{value}</dd>
    </div>
  );
}
