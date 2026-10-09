'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RouteStatus, type RouteCapabilities } from '@kobrax/shared';
import { ReasonDialog } from '@/components/reason-dialog';
import { postJson, sendJson } from '@/lib/client';

type Dialog = 'start' | 'complete' | 'cancel' | 'request-cancel' | null;

/**
 * Las acciones de la ruta, **según lo que la API dice que esta persona puede** (`capabilities`): iniciar, completar,
 * cancelar y optimizar el orden — y para quien no manda sobre la ruta, **pedir** que se cancele.
 *
 * 🔴 **Los botones que no se pueden usar no se muestran** (decisión de la dueña): un botón gris que no explica por qué
 * es ruido. La excepción es cancelar con visitas ya registradas, que se muestra deshabilitado **con la razón**: quien
 * lo busca necesita saber que no es un error, que esa información no se borra y que lo que corresponde es completar.
 *
 * La API vuelve a validar cada cambio (transición, motivo, autoría): esto es cortesía, no la guarda.
 */
export function RouteActions({
  routeId,
  status,
  capabilities: caps,
  openStops,
  viewerIsCollector,
}: {
  routeId: string;
  status: RouteStatus;
  capabilities: RouteCapabilities;
  /** Paradas sin gestionar: lo que se salta al completar o cancelar. */
  openStops: number;
  /** Quien mira es el cobrador de la ruta: ella no necesita motivo para iniciarla ni para cerrarla limpia. */
  viewerIsCollector: boolean;
}) {
  const t = useTranslations('panel.routes.actions');
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<'optimize' | 'start' | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);

  async function setStatus(next: RouteStatus, reason?: string): Promise<string | null> {
    const { ok, data } = await sendJson(`/api/routes/${routeId}/status`, { status: next, ...(reason ? { reason } : {}) }, 'PATCH');
    if (!ok) return data.error?.message ?? t('error');
    router.refresh();
    return null;
  }

  async function startNow() {
    setBusy('start');
    setNotice(null);
    const failed = await setStatus(RouteStatus.IN_PROGRESS);
    setBusy(null);
    if (failed) setNotice({ text: failed, tone: 'error' });
  }

  async function optimize() {
    setBusy('optimize');
    setNotice(null);
    const { ok, data } = await postJson(`/api/routes/${routeId}/optimize`, {});
    setBusy(null);
    if (!ok) return setNotice({ text: data.error?.message ?? t('error'), tone: 'error' });
    setNotice({ text: t('optimized'), tone: 'ok' });
    router.refresh();
  }

  async function requestCancel(reason: string): Promise<string | null> {
    const { ok, data } = await postJson(`/api/routes/${routeId}/change-requests`, { kind: 'CANCEL', payload: {}, reason });
    if (!ok) return data.error?.message ?? t('error');
    setNotice({ text: t('requestSent'), tone: 'ok' });
    router.refresh();
    return null;
  }

  const closed = status === RouteStatus.COMPLETED || status === RouteStatus.CANCELLED;
  // Iniciar la ruta de otra persona exige dejar el motivo; la propia (o la que armó quien la inicia), no.
  const startNeedsReason = !viewerIsCollector && !caps.isOwner;
  const completeNeedsReason = openStops > 0 || (!viewerIsCollector && !caps.isOwner);

  const btn = 'inline-flex h-9 items-center rounded-lg px-3.5 text-[13px] font-medium disabled:opacity-60';
  const primary = `${btn} bg-k-navy text-white hover:bg-k-slate`;
  const ghost = `${btn} border border-k-border bg-white text-k-text-2 hover:bg-k-bg`;

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {caps.start && (
          <button
            type="button"
            disabled={busy === 'start'}
            onClick={() => (startNeedsReason ? setDialog('start') : void startNow())}
            className={primary}
          >
            {t('start')}
          </button>
        )}
        {caps.complete && (
          <button type="button" onClick={() => setDialog('complete')} className={primary}>
            {t('complete')}
          </button>
        )}
        {caps.edit && !closed && openStops > 1 && (
          <button type="button" disabled={busy === 'optimize'} onClick={() => void optimize()} className={ghost}>
            {busy === 'optimize' ? t('optimizing') : t('optimize')}
          </button>
        )}
        {caps.cancel && (
          <button type="button" onClick={() => setDialog('cancel')} className={`${ghost} text-k-danger`}>
            {t('cancel')}
          </button>
        )}
        {!caps.cancel && caps.cancelBlockedByVisits && (
          <button type="button" disabled title={t('cancelBlocked')} className={`${ghost} text-k-muted`}>
            {t('cancel')}
          </button>
        )}
        {!caps.cancel && !caps.cancelBlockedByVisits && caps.requestChange && !closed && (
          <button type="button" onClick={() => setDialog('request-cancel')} className={ghost}>
            {t('requestCancel')}
          </button>
        )}
      </div>

      {/* El motivo del botón gris, a la vista y no solo en un tooltip que en el celular no existe. */}
      {!caps.cancel && caps.cancelBlockedByVisits && <p className="mt-2 text-right text-[12px] text-k-text-2">{t('cancelBlocked')}</p>}
      {notice && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`mt-2 text-right text-[13px] ${notice.tone === 'error' ? 'text-k-danger' : 'text-k-success'}`}
        >
          {notice.text}
        </p>
      )}

      <ReasonDialog
        open={dialog === 'start'}
        onClose={() => setDialog(null)}
        title={t('startOtherTitle')}
        confirmLabel={t('start')}
        onConfirm={(reason) => setStatus(RouteStatus.IN_PROGRESS, reason)}
      >
        {t('startOtherText')}
      </ReasonDialog>

      <ReasonDialog
        open={dialog === 'complete'}
        onClose={() => setDialog(null)}
        title={t('completeTitle')}
        confirmLabel={t('complete')}
        required={completeNeedsReason}
        label={openStops > 0 ? t('pendingReasonLabel') : t('reasonLabel')}
        onConfirm={(reason) => setStatus(RouteStatus.COMPLETED, reason || undefined)}
      >
        {openStops > 0 ? t('completePending', { n: openStops }) : t('completeClean')}
      </ReasonDialog>

      <ReasonDialog
        open={dialog === 'cancel'}
        onClose={() => setDialog(null)}
        title={t('cancelTitle')}
        confirmLabel={t('cancelConfirm')}
        tone="danger"
        onConfirm={(reason) => setStatus(RouteStatus.CANCELLED, reason)}
      >
        {openStops > 0 ? t('cancelText', { n: openStops }) : t('cancelTextEmpty')}
      </ReasonDialog>

      <ReasonDialog
        open={dialog === 'request-cancel'}
        onClose={() => setDialog(null)}
        title={t('requestCancelTitle')}
        confirmLabel={t('requestSend')}
        onConfirm={requestCancel}
      >
        {t('requestCancelText')}
      </ReasonDialog>
    </>
  );
}
