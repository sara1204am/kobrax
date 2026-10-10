'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { RouteStopItem } from '@kobrax/shared';
import { money } from '@/lib/format';
import { RecordVisitDialog } from './record-visit-dialog';
import { WhatsAppButton } from './whatsapp-button';

/**
 * «Siguiente parada»: lo que sigue en la jornada, a la vista en la ficha de la ruta (F4/12).
 *
 * Responde a «¿qué toca ahora?» sin recorrer la tabla: quién, dónde, cuánto debe, desde cuándo, y la acción — registrar
 * la gestión (si esta persona puede) o abrir el detalle de la parada.
 */
export function NextStopCard({
  routeId,
  stop,
  canRecord,
  collectorName,
  viewerIsCollector,
  canPay,
  today,
}: {
  routeId: string;
  /** La primera parada sin gestionar, o `undefined` si ya no queda ninguna. */
  stop?: RouteStopItem;
  canRecord: boolean;
  collectorName: string;
  viewerIsCollector: boolean;
  canPay: boolean;
  today: string;
}) {
  const t = useTranslations('panel.routes');
  const [open, setOpen] = useState(false);

  if (!stop) {
    return (
      <section aria-label={t('detail.nextStop')} className="rounded-2xl border border-k-border bg-white p-5 shadow-k-card">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-k-text-2">{t('detail.nextStop')}</h2>
        <p className="mt-2 text-[14px] text-k-text-2">{t('detail.nextStopDone')}</p>
      </section>
    );
  }

  return (
    <section aria-label={t('detail.nextStop')} className="rounded-2xl border border-k-border bg-white px-6 py-4 shadow-k-card">
      {/* Una sola fila: quién sigue, cuánto debe y qué hacer. En pantalla angosta baja a varias líneas. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <h2 className="w-28 shrink-0 text-[13px] font-semibold text-k-navy">{t('detail.nextStop')}</h2>

        <div className="flex min-w-0 flex-1 items-center gap-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-k-info-bg text-[14px] font-semibold tabular-nums text-k-slate">
            {stop.sequenceOrder}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-k-text">{stop.clientName ?? '—'}</p>
            <p className="truncate text-[13px] text-k-text-2">
              {[stop.locationOwner, stop.address].filter(Boolean).join(' · ') || '—'}
              {stop.scheduledTime && <span className="ml-2 tabular-nums text-k-navy">{stop.scheduledTime}</span>}
            </p>
          </div>
        </div>

        {(stop.overdueAmount != null || stop.daysPastDue != null) && (
          <div className="flex shrink-0 items-center gap-4 border-l border-k-border pl-6">
            {stop.overdueAmount != null && (
              <span className="text-[14px] font-semibold tabular-nums text-k-text">{money(stop.overdueAmount, stop.currency ?? 'BOB')}</span>
            )}
            {stop.daysPastDue != null && (
              <span className="text-[13px] font-medium tabular-nums text-k-danger">{t('stopsTable.days', { n: stop.daysPastDue })}</span>
            )}
          </div>
        )}

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <WhatsAppButton clientId={stop.clientId} clientName={stop.clientName} />
          {canRecord && stop.creditId && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="h-9 rounded-lg bg-k-navy px-4 text-[13px] font-semibold text-white hover:bg-k-slate"
            >
              {t('detail.register')}
            </button>
          )}
          <Link
            href={`/rutas/${routeId}/parada/${stop.id}`}
            className="inline-flex h-9 items-center rounded-lg border border-k-border bg-white px-4 text-[13px] font-medium text-k-slate hover:bg-k-bg"
          >
            {t('detail.viewStop')}
          </Link>
        </div>
      </div>

      {open && (
        <RecordVisitDialog
          open
          onClose={() => setOpen(false)}
          stop={{
            id: stop.id,
            creditId: stop.creditId,
            clientName: stop.clientName,
            address: stop.address,
            latitude: stop.latitude,
            longitude: stop.longitude,
            overdueAmount: stop.overdueAmount,
            currency: stop.currency,
            externalSource: stop.externalSource,
            locationId: stop.locationId,
          }}
          collectorName={collectorName}
          viewerIsCollector={viewerIsCollector}
          canPay={canPay}
          today={today}
        />
      )}
    </section>
  );
}
