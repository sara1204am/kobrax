'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { AccountRequestInfo } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { Section } from '@/components/panel-ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { dateTime } from '@/lib/format';

/**
 * Pedir la baja de la cuenta. **No borra nada**: deja un pedido que Kobrax atiende (el plan y el ciclo de vida los
 * gestiona Kobrax). Para pedirla hay que escribir el nombre del negocio — el freno contra un clic equivocado — y la API
 * lo vuelve a comprobar.
 */
export function ClosureRequest({
  businessName,
  requests,
  timezone,
}: {
  businessName: string;
  requests: AccountRequestInfo[];
  timezone: string | null;
}) {
  const t = useTranslations('account.advanced.closure');
  const router = useRouter();
  const locale = useLocale();
  const toast = useToast();

  const pending = requests.find((r) => r.type === 'CLOSURE' && r.status === 'PENDING');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = name.trim().toLowerCase() === businessName.trim().toLowerCase();

  async function send() {
    setBusy(true);
    setError(null);
    const { ok, data } = await sendJson('/api/account/requests', { type: 'CLOSURE', confirmName: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) }, 'POST');
    setBusy(false);
    if (!ok) {
      setError(data.error?.message ?? t('error'));
      return;
    }
    setOpen(false);
    setName('');
    setNote('');
    toast(t('sent'));
    router.refresh();
  }

  return (
    <Section title={t('title')} inner="space-y-4 p-6">
      <p className="text-[13px] leading-relaxed text-k-text-2">{t('intro')}</p>

      {pending ? (
        <p role="status" className="rounded-xl bg-k-highlight px-4 py-3 text-[13px] text-k-navy">
          {t('pending', { date: dateTime(pending.createdAt, locale, timezone ?? undefined) })}
        </p>
      ) : (
        <div className="sm:w-60">
          <Button
            variant="danger"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
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
            <span className="sm:w-48">
              <Button variant="danger" loading={busy} disabled={!matches} onClick={() => void send()}>
                {t('send')}
              </Button>
            </span>
          </>
        }
      >
        <div className="space-y-4">
          <ErrorBanner message={error} />
          <p>{t('modalText')}</p>
          <Field label={t('confirmLabel', { name: businessName })}>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
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
