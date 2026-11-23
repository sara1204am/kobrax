'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { LateInterestView } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { Section } from '@/components/panel-ui';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';
import { dayDate, money } from '@/lib/format';

/**
 * El interés moratorio de UN crédito (F17): devengado, cobrado, exonerado y lo pendiente, y la mora por cuota. Va APARTE del saldo del plan.
 *
 * No calcula nada: todo viene de la API (reproducido de los hechos). Quien tiene `payment:waive_late` puede perdonar mora de una cuota, con un
 * motivo obligatorio que queda en el hecho y en la auditoría. `lateInterest` nulo/ausente = el crédito no devenga: no se dibuja nada.
 */
export function LateInterestSection({ creditId, currency, lateInterest }: { creditId: string; currency: string; lateInterest?: LateInterestView | null }) {
  const t = useTranslations('lateInterest');
  const locale = useLocale();
  const { can } = usePermissions();
  const [waiving, setWaiving] = useState(false);
  const [activating, setActivating] = useState(false);
  if (!lateInterest) {
    // F3-e: un crédito que nació sin mora puede empezar a devengarla desde una fecha futura, con el permiso propio. La API valida el resto.
    if (!can('payment:activate_late')) return null;
    return (
      <Section title={t('title')} action={<Button type="button" variant="ghost" onClick={() => setActivating(true)}>{t('activate.cta')}</Button>}>
        <p className="text-k-sm text-k-muted">{t('activate.hint')}</p>
        <ActivateModal open={activating} onClose={() => setActivating(false)} creditId={creditId} />
      </Section>
    );
  }
  const canWaive = can('payment:waive_late') && lateInterest.pending > 0;

  return (
    <Section title={t('title')} action={canWaive ? <Button type="button" variant="ghost" onClick={() => setWaiving(true)}>{t('waive.cta')}</Button> : undefined}>
      <dl className="mb-4 grid gap-x-6 gap-y-3 sm:grid-cols-4" data-testid="late-interest-summary">
        <Figure label={t('accrued')} value={money(lateInterest.accrued, currency)} />
        <Figure label={t('collected')} value={money(lateInterest.collected, currency)} />
        <Figure label={t('waived')} value={money(lateInterest.waived, currency)} />
        <Figure label={t('pending')} value={money(lateInterest.pending, currency)} strong />
      </dl>
      {lateInterest.installments.length === 0 ? (
        <p className="text-k-sm text-k-muted">{t('none')}</p>
      ) : (
        <table className="w-full text-k-sm">
          <thead>
            <tr className="text-left text-k-muted">
              <th className="py-1 font-medium">{t('installment')}</th>
              <th className="py-1 font-medium">{t('dueDate')}</th>
              <th className="py-1 text-right font-medium">{t('accrued')}</th>
              <th className="py-1 text-right font-medium">{t('pending')}</th>
            </tr>
          </thead>
          <tbody>
            {lateInterest.installments.map((i) => (
              <tr key={i.installmentNumber} className="border-t border-k-border">
                <td className="py-1">#{i.installmentNumber}</td>
                <td className="py-1">{dayDate(i.dueDate, locale)}</td>
                <td className="py-1 text-right">{money(i.accrued, currency)}</td>
                <td className="py-1 text-right font-medium">{money(i.pending, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {lateInterest.policy.startsOn && <p className="mt-3 text-k-xs text-k-muted">{t('startsOn', { date: dayDate(lateInterest.policy.startsOn, locale) })}</p>}
      <p className="mt-3 text-k-xs text-k-muted">{t('basis', { rate: lateInterest.policy.annualRate, days: lateInterest.policy.dayCount, grace: lateInterest.policy.graceDays })}</p>
      {canWaive && <WaiveModal open={waiving} onClose={() => setWaiving(false)} creditId={creditId} currency={currency} lateInterest={lateInterest} />}
    </Section>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-k-xs text-k-muted">{label}</dt>
      <dd className={strong ? 'text-k-md font-semibold text-k-navy' : 'text-k-base text-k-text'}>{value}</dd>
    </div>
  );
}

function ActivateModal({ open, onClose, creditId }: { open: boolean; onClose: () => void; creditId: string }) {
  const t = useTranslations('lateInterest.activate');
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [startsOn, setStartsOn] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(startsOn) && reason.trim().length >= 3;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/credits/${creditId}/late-activation`, { startsOn, reason: reason.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ? errorText(res.data.error, tRoot, locale) : t('failed'));
      return;
    }
    toast(t('done'));
    setStartsOn('');
    setReason('');
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title={t('title')} locked={busy}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-k-sm text-k-text-2">{t('text')}</p>
        <Field label={t('startsOn')} hint={t('startsOnHint')} required>
          <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
        </Field>
        <Field label={t('reason')} hint={t('reasonHint')} required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-3">
          <span className="w-32">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          </span>
          <span className="w-40">
            <Button type="submit" loading={busy} disabled={!valid}>{t('confirm')}</Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

function WaiveModal({ open, onClose, creditId, currency, lateInterest }: { open: boolean; onClose: () => void; creditId: string; currency: string; lateInterest: LateInterestView }) {
  const t = useTranslations('lateInterest.waive');
  const tRoot = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const withPending = lateInterest.installments.filter((i) => i.pending > 0);
  const [installment, setInstallment] = useState(String(withPending[0]?.installmentNumber ?? ''));
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = withPending.find((i) => String(i.installmentNumber) === installment);
  const value = Number(amount.replace(',', '.'));
  const over = !!row && value > row.pending + 0.005;
  const valid = !!row && value > 0 && !over && reason.trim().length >= 3;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    const res = await sendJson(`/api/credits/${creditId}/late-waivers`, { installmentNumber: Number(installment), amount: Math.round(value * 100) / 100, reason: reason.trim() });
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ? errorText(res.data.error, tRoot, locale) : t('failed'));
      return;
    }
    toast(t('done'));
    setAmount('');
    setReason('');
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title={t('title')} locked={busy}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-k-sm text-k-text-2">{t('text')}</p>
        <Field label={t('installment')}>
          <Select value={installment} onChange={(e) => { setInstallment(e.target.value); setAmount(''); }}>
            {withPending.map((i) => (
              <option key={i.installmentNumber} value={i.installmentNumber}>{`#${i.installmentNumber} · ${money(i.pending, currency)}`}</option>
            ))}
          </Select>
        </Field>
        <Field label={t('amount')} error={over ? t('exceeds', { max: money(row!.pending, currency) }) : undefined} required>
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={row ? String(row.pending) : ''} />
        </Field>
        <Field label={t('reason')} hint={t('reasonHint')} required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-3">
          <span className="w-32">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>{t('cancel')}</Button>
          </span>
          <span className="w-40">
            <Button type="submit" loading={busy} disabled={!valid}>{t('confirm')}</Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
