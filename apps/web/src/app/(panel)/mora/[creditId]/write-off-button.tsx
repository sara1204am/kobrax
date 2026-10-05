'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * Castigar el crédito o revertir el castigo (F4/08 · D1-a).
 *
 * 🔴 **Sólo para quien puede** (`credit:write` **y** alcance total: gerente y administrador). La API lo exige igual;
 * acá no se dibuja el botón a quien no, en vez de ofrecerlo para devolver un 403. El castigo es una condición
 * aparte: no cierra la mora ni toca los días. Pide un motivo **opcional**.
 */
export function WriteOffButton({ creditId, writtenOff, canWriteOff }: { creditId: string; writtenOff: boolean; canWriteOff: boolean }) {
  const t = useTranslations('panel.mora');
  const tw = useTranslations('panel.mora.gestion.writeOff');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canWriteOff) return null;

  function close() {
    setOpen(false);
    setReason('');
    setError(null);
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    const res = writtenOff
      ? await sendJson(`/api/credits/${creditId}/write-off`, {}, 'DELETE')
      : await sendJson(`/api/credits/${creditId}/write-off`, reason.trim() ? { reason: reason.trim() } : {}, 'POST');
    setBusy(false);
    if (!res.ok) {
      setError(res.data.error ? errorText(res.data.error, t, locale) : tw('error'));
      return;
    }
    close();
    toast(writtenOff ? tw('revertDone') : tw('done'));
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)} className="sm:w-auto sm:px-5">
        {writtenOff ? tw('revert') : tw('cta')}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={writtenOff ? tw('revertTitle') : tw('title')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {tw('cancel')}
            </Button>
            <Button onClick={confirm} loading={busy} className="sm:w-auto sm:px-5">
              {writtenOff ? tw('revertConfirm') : tw('confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{writtenOff ? tw('revertText') : tw('text')}</p>
        {/* El motivo sólo se pide al castigar: revertir no lo lleva. */}
        {!writtenOff && (
          <div className="mt-4">
            <Field label={tw('reason')}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={500} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
