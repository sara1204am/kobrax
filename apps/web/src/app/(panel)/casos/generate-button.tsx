'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * Generar los casos de la cartera en mora (`case:assign`).
 *
 * Crea **un caso por cada crédito con atraso que no tenga uno abierto**, y puede ser mucho de una
 * sola vez. Por eso pide confirmación y dice en la misma frase que **no hay forma de deshacerlo en
 * bloque**: el conteo que vuelve es lo único que después cuenta qué pasó.
 *
 * `minDaysPastDue` vacío = el mínimo que tenga configurado el tenant. No se inventa un default
 * acá: esa decisión ya vive en la configuración de la cuenta.
 */
export function GenerateButton() {
  const t = useTranslations('panel.cases');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [minDays, setMinDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    setBusy(true);
    const { ok, data } = await sendJson<{ created: number }>(
      '/api/cases/generate',
      minDays.trim() ? { minDaysPastDue: Number(minDays) } : {},
    );
    setBusy(false);
    if (!ok) {
      setError(errorText(data.error, t, locale));
      return;
    }
    setOpen(false);
    toast(data.created > 0 ? t('generate.done', { n: data.created }) : t('generate.none'));
    router.refresh();
  }

  return (
    <>
      <span className="w-full sm:w-auto">
        <Button onClick={() => setOpen(true)} className="sm:w-auto sm:px-5">
          {t('generate.cta')}
        </Button>
      </span>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('generate.title')}
        actions={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy} className="sm:w-auto sm:px-5">
              {t('generate.cancel')}
            </Button>
            <Button onClick={generate} loading={busy} className="sm:w-auto sm:px-5">
              {t('generate.confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('generate.text')}</p>
        <p className="mt-2 font-medium text-k-warning-text">{t('generate.warning')}</p>
        <div className="mt-4">
          <Field label={t('generate.minDays')}>
            <Input
              type="number"
              min={0}
              value={minDays}
              onChange={(e) => setMinDays(e.target.value)}
              disabled={busy}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
