'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { CaseStatus } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { nextStates, STATUS_TONE } from '@/lib/cases';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';

/**
 * El estado de la cobranza, **y el control para cambiarlo, en el mismo lugar**.
 *
 * 🔴 Antes el estado era una etiqueta muerta en la tarjeta y «Mover la cobranza» un botón de texto
 * arriba en el encabezado — a media pantalla del dato que cambia. Nada decía que la etiqueta se
 * pudiera tocar, y quien buscaba cómo cambiarla tenía que encontrar un botón que no la nombraba.
 * Ahora se toca la etiqueta: lleva el lápiz y el tooltip que dicen que es un control.
 *
 * Sin destinos válidos —una cobranza cerrada— se dibuja la etiqueta sola, sin lápiz. Ofrecer un
 * control que sólo puede fallar enseña a desconfiar de la pantalla.
 */
export function StatusControl({
  caseId,
  status,
  canWrite,
}: {
  caseId: string;
  status: CaseStatus;
  canWrite: boolean;
}) {
  const t = useTranslations('panel.cases');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<CaseStatus | ''>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const states = nextStates(status);
  const etiqueta = <Badge tone={STATUS_TONE[status]}>{t(`status.${status}`)}</Badge>;

  if (!canWrite || states.length === 0) return etiqueta;

  function cerrar() {
    setOpen(false);
    setError(null);
    setTo('');
    setReason('');
  }

  async function mover() {
    setError(null);
    setBusy(true);
    const res = await sendJson(`/api/cases/${caseId}`, { status: to, reason: reason.trim() || undefined }, 'PATCH');
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data.error, t, locale));
    cerrar();
    toast(t('transition.done'));
    router.refresh();
  }

  return (
    <>
      {/*
       * `title` **y** `aria-label`: el tooltip del navegador es para quien ve, y el rótulo accesible
       * para quien no. Uno solo deja afuera a la mitad.
       */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t('transition.tooltip')}
        aria-label={t('transition.tooltip')}
        className="inline-flex items-center gap-1.5 rounded-lg border border-transparent px-1 py-0.5 hover:border-k-border hover:bg-k-bg"
      >
        {etiqueta}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="text-k-muted">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      </button>

      {/* Sólo los destinos válidos desde el estado actual: el resto lo rechaza la API con CASE_002. */}
      <Modal
        open={open}
        onClose={cerrar}
        title={t('transition.title')}
        actions={
          <>
            <span className="sm:w-40">
              <Button variant="ghost" onClick={cerrar} disabled={busy}>
                {t('transition.cancel')}
              </Button>
            </span>
            <span className="sm:w-48">
              <Button onClick={() => void mover()} loading={busy} disabled={!to}>
                {t('transition.confirm')}
              </Button>
            </span>
          </>
        }
      >
        <ErrorBanner message={error} />
        {/* De dónde sale y a dónde puede ir. Sin el estado actual a la vista, «Mover» pide elegir un
            destino sin decir desde dónde — y las opciones cambian según eso. */}
        <p>
          {t('transition.from')} {etiqueta}
        </p>
        <div className="mt-4 space-y-4">
          <Field label={t('transition.to')}>
            <Select value={to} onChange={(e) => setTo(e.target.value as CaseStatus)} disabled={busy}>
              <option value="">{t('transition.pick')}</option>
              {states.map((next) => (
                <option key={next} value={next}>
                  {t(`status.${next}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('transition.reason')}>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={200} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
