'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { PLAN_ORDER, type AccountInfo, type AccountRequestInfo } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Select } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { usePermissions } from '@/components/permissions';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { dateTime } from '@/lib/format';

/**
 * Pedirle a Kobrax un cambio de plan. **No cambia nada por sí solo**: queda registrado, se le avisa al equipo y lo
 * atiende por consola (el plan lo gestiona Kobrax). La pantalla muestra el estado del último pedido para que quien
 * pidió sepa si ya lo vieron.
 */
export function PlanRequest({ account, requests }: { account: AccountInfo; requests: AccountRequestInfo[] }) {
  const t = useTranslations('account.planRequest');
  const tp = useTranslations('plans');
  const router = useRouter();
  const locale = useLocale();
  const toast = useToast();
  const { can } = usePermissions();
  const editable = can('account:write');

  const changes = requests.filter((r) => r.type === 'PLAN_CHANGE');
  const pending = changes.find((r) => r.status === 'PENDING');
  const last = changes.find((r) => r.status !== 'PENDING');
  const options = PLAN_ORDER.filter((code) => code !== account.planCode);

  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<string>(options[0] ?? '');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson('/api/account/requests', { type: 'PLAN_CHANGE', plan, ...(note.trim() ? { note: note.trim() } : {}) }, 'POST');
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    setOpen(false);
    setNote('');
    toast(t('sent'));
    router.refresh();
  }

  const when = (iso: string) => dateTime(iso, locale, account.timezone ?? undefined);
  const name = (code: string | null) => (code && (PLAN_ORDER as string[]).includes(code) ? tp(`names.${code}`) : (code ?? ''));

  return (
    <Section title={t('title')} inner="space-y-4 p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      {pending && (
        <p role="status" className="rounded-xl bg-k-highlight px-4 py-3 text-[13px] text-k-navy">
          {t('pending', { plan: name(pending.plan), date: when(pending.createdAt) })}
        </p>
      )}

      {last && (
        <p className="rounded-xl bg-k-light-bg px-4 py-3 text-[13px] text-k-text-2">
          {last.status === 'HANDLED' ? t('handled', { plan: name(last.plan) }) : t('rejected', { plan: name(last.plan) })}
          {last.handledNote ? ` “${last.handledNote}”` : ''}
        </p>
      )}

      {editable && !pending && (
        <div className="sm:w-60">
          <Button variant="ghost" onClick={() => { setError(null); setOpen(true); }}>
            {t('ask')}
          </Button>
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('modalTitle')}
        actions={
          <>
            <span className="sm:w-36">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
            </span>
            <span className="sm:w-44">
              <Button loading={busy} disabled={!plan} onClick={() => void send()}>
                {t('send')}
              </Button>
            </span>
          </>
        }
      >
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <Field label={t('plan')}>
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {options.map((code) => (
                <option key={code} value={code}>
                  {tp(`names.${code}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('note')} hint={t('noteHint')}>
            <textarea
              value={note}
              maxLength={500}
              rows={3}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-xl border border-k-border bg-white px-3 py-2 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
            />
          </Field>
        </div>
      </Modal>
    </Section>
  );
}
