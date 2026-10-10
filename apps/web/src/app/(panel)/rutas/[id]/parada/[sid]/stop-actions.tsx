'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { RecordVisitDialog, type RecordStop } from '../../record-visit-dialog';

/**
 * «Registrar gestión» sobre esta parada, o «Corregir» una visita ya registrada (que no se edita: se guarda una nueva
 * que apunta a la que corrige). Es solo el botón y su diálogo: la página es del servidor.
 */
export function StopRecordButton({
  stop,
  collectorName,
  viewerIsCollector,
  canPay,
  today,
  correctsVisitId,
  variant = 'primary',
}: {
  stop: RecordStop;
  collectorName: string;
  viewerIsCollector: boolean;
  canPay: boolean;
  today: string;
  correctsVisitId?: string;
  variant?: 'primary' | 'ghost';
}) {
  const t = useTranslations('panel.routes.stopPage');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          variant === 'primary'
            ? 'h-10 rounded-xl bg-k-navy px-4 text-[14px] font-semibold text-white hover:bg-k-slate'
            : 'h-8 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-slate hover:bg-k-bg'
        }
      >
        {correctsVisitId ? t('fix') : t('register')}
      </button>
      {open && (
        <RecordVisitDialog
          open
          onClose={() => setOpen(false)}
          stop={stop}
          collectorName={collectorName}
          viewerIsCollector={viewerIsCollector}
          canPay={canPay}
          today={today}
          correctsVisitId={correctsVisitId}
        />
      )}
    </>
  );
}
