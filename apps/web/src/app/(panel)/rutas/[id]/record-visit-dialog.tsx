'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  AgendaItemType,
  AgendaTimeSlot,
  ScheduleTimeMode,
  VISIT_VARIANT_KEYS,
  VARIANT_OUTCOME,
  buildVisitDetails,
  canSubmitVisitResult,
  initialVisitResult,
  paymentCap,
  paymentOutcome,
  type VariantKey,
  type VisitResultForm,
} from '@kobrax/shared';
import { Modal } from '@/components/modal';
import { dayDate, money } from '@/lib/format';
import { postJson } from '@/lib/client';

/** La parada sobre la que se registra: lo que el formulario necesita saber de ella. */
export interface RecordStop {
  id: string;
  creditId?: string;
  clientName?: string;
  address?: string;
  /** El punto conocido de la parada: se manda como ubicación estimada (el panel no tiene el GPS del cobrador). */
  latitude?: number;
  longitude?: number;
  overdueAmount?: number;
  /** La cuota que correspondía pagar y cuándo vencía: se muestra bajo el monto, si hay dato. */
  installmentAmount?: number;
  nextDueDate?: string;
  currency?: string;
  externalSource?: string;
  /** La ubicación que se visita: sin ella, «volver a visitar» agenda con la dirección escrita. */
  locationId?: string;
}

/** Cada variante, con el color de su tarjeta y el trazo de su ícono. Colores del sistema, sin tonos nuevos. */
const VARIANT_UI: Record<VariantKey, { tile: string; ring: string; path: string }> = {
  PAID: { tile: 'bg-k-success-bg text-k-success', ring: 'border-k-success', path: 'M5 12.5l4.5 4.5L19 7.5' },
  PROMISE: { tile: 'bg-k-warning-bg text-k-warning-text', ring: 'border-k-warning', path: 'M12 6v6l4 2M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z' },
  NO_ANSWER: { tile: 'bg-k-warning-bg text-k-warning-text', ring: 'border-k-warning', path: 'M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1L6.6 10.8ZM4 4l16 16' },
  NO_CONTACT_VISIT: { tile: 'bg-k-bg text-k-text-2', ring: 'border-k-slate', path: 'M4 20V9l8-5 8 5v11M9 20v-6h6v6' },
  WRONG_ADDRESS: { tile: 'bg-k-danger-bg text-k-danger', ring: 'border-k-danger', path: 'M12 21s-7-5.6-7-11a7 7 0 1 1 14 0c0 5.4-7 11-7 11ZM9.5 8.5l5 5M14.5 8.5l-5 5' },
  SPECIAL: { tile: 'bg-k-highlight text-k-purple', ring: 'border-k-purple', path: 'M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4' },
};

/** Las gestiones en las que no se encontró a nadie: ahí tiene sentido «volver otro día». */
const REVISIT_VARIANTS: readonly VariantKey[] = ['NO_ANSWER', 'NO_CONTACT_VISIT'];
const REVISIT_SLOTS = [AgendaTimeSlot.MORNING, AgendaTimeSlot.AFTERNOON, AgendaTimeSlot.NIGHT] as const;

const METHODS = ['CASH', 'QR', 'TRANSFER'] as const;

/**
 * **Registrar una gestión desde el panel** (F4/12 · decisión 2): el cobrador se olvidó, no tenía señal o se quedó sin
 * batería, y quien armó la ruta (o quien administra rutas) la carga a su nombre, con calma.
 *
 * Son **las mismas seis variantes del móvil y las mismas reglas** (`@kobrax/shared`): qué es un cobro, hasta cuánto se
 * puede cobrar, cuándo una gestión está completa. Lo que cambia es de dónde sale el punto: el panel no tiene el GPS del
 * cobrador, así que manda el punto conocido de la parada y la API lo marca como **ubicación estimada**; la visita queda
 * a nombre del cobrador, con quién la cargó.
 *
 * 🔴 **Una visita no se edita.** Con `correctsVisitId` esto registra una NUEVA que apunta a la que corrige, y la API la
 * guarda como nota (no cuenta otra gestión).
 *
 * 🔴 **Qué falla después de registrada la visita se dice, no se esconde**: la visita ya existe y es inmutable, así que si
 * la foto, el cobro o la promesa no salieron se avisa cuál para que se repita a mano. Cerrar como si nada dejaba un cobro
 * perdido.
 */
export function RecordVisitDialog({
  open,
  onClose,
  stop,
  collectorName,
  viewerIsCollector,
  canPay,
  today,
  correctsVisitId,
}: {
  open: boolean;
  onClose: () => void;
  stop: RecordStop;
  collectorName: string;
  viewerIsCollector: boolean;
  /** `payment:write`: sin él no se registra un cobro (solo lo tienen el cobrador y el administrador). */
  canPay: boolean;
  today: string;
  correctsVisitId?: string;
}) {
  const t = useTranslations('panel.routes.record');
  const tMethod = useTranslations('panel.payments.method');
  const router = useRouter();

  const [variant, setVariant] = useState<VariantKey | null>(null);
  const [form, setForm] = useState<VisitResultForm>(() => initialVisitResult(today));
  const [photo, setPhoto] = useState<{ url: string; hash: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  /** «Volver a visitar»: agenda una nueva visita a este crédito, para otro día o más tarde hoy. */
  const [revisit, setRevisit] = useState(false);
  const [revisitDate, setRevisitDate] = useState(today);
  const [revisitSlot, setRevisitSlot] = useState<AgendaTimeSlot>(AgendaTimeSlot.AFTERNOON);
  const [categories, setCategories] = useState<{ code: string; label: string }[]>([]);
  const [promiseMethods, setPromiseMethods] = useState<{ code: string; label: string }[]>([]);
  // El mismo id en un reintento: la API responde con la visita que ya guardó, sin duplicarla.
  const visitId = useRef<string>('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    visitId.current = crypto.randomUUID();
    setVariant(null);
    setForm(initialVisitResult(today));
    setPhoto(null);
    setError(null);
    setWarnings([]);
    setRevisit(false);
    setRevisitDate(today);
    setRevisitSlot(AgendaTimeSlot.AFTERNOON);
  }, [open, today]);

  // Los catálogos solo hacen falta para dos variantes: se piden al elegirlas.
  useEffect(() => {
    if (variant !== 'SPECIAL' || categories.length > 0) return;
    void fetch('/api/catalogs/SPECIAL_CATEGORY')
      .then((r) => r.json())
      .then((b) => setCategories(Array.isArray(b?.data) ? b.data : []))
      .catch(() => setCategories([]));
  }, [variant, categories.length]);
  useEffect(() => {
    if (variant !== 'PROMISE' || promiseMethods.length > 0) return;
    void fetch('/api/catalogs/PAYMENT_METHOD')
      .then((r) => r.json())
      .then((b) => {
        const list: { code: string; label: string }[] = Array.isArray(b?.data) ? b.data : [];
        setPromiseMethods(list);
        if (list.length > 0) setForm((f) => (list.some((m) => m.code === f.paymentMethodCode) ? f : { ...f, paymentMethodCode: list[0]!.code }));
      })
      .catch(() => setPromiseMethods([]));
  }, [variant, promiseMethods.length]);

  const cap = paymentCap(stop);
  const currency = stop.currency ?? 'BOB';
  const locale = useLocale();
  const set = <K extends keyof VisitResultForm>(k: K, v: VisitResultForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  // Agendar la visita pide saber a dónde: la ubicación de la parada, o al menos su dirección.
  const canRevisit = variant !== null && REVISIT_VARIANTS.includes(variant) && !!(stop.locationId || stop.address?.trim());
  const revisitOn = canRevisit && revisit;
  const ready = variant !== null && canSubmitVisitResult(variant, form, cap) && !uploading && (!revisitOn || /^\d{4}-\d{2}-\d{2}$/.test(revisitDate));

  const ui = useMemo(() => (variant ? VARIANT_UI[variant] : null), [variant]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/account/upload', { method: 'POST', body }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setUploading(false);
    if (!res?.ok || !data?.url || !data?.hash) return setError(data?.error?.message ?? t('photoError'));
    setPhoto({ url: data.url, hash: data.hash, name: file.name });
  }

  async function submit() {
    if (!variant || !stop.creditId) return;
    setBusy(true);
    setError(null);
    setWarnings([]);

    const amount = Number(form.amount);
    const outcome = variant === 'PAID' ? paymentOutcome(amount, cap) : VARIANT_OUTCOME[variant];
    const visit = await postJson<{ id: string }>('/api/visits', {
      id: visitId.current,
      routeStopId: stop.id,
      creditId: stop.creditId,
      // El panel no tiene el GPS del cobrador: el punto conocido de la parada, marcado como estimado por la API.
      lat: stop.latitude ?? 0,
      lng: stop.longitude ?? 0,
      gpsFallback: true,
      source: 'WEB',
      outcome,
      notes: form.notes.trim() || undefined,
      details: buildVisitDetails(variant, form),
      ...(correctsVisitId ? { correctsVisitId } : {}),
    });
    if (!visit.ok) {
      setBusy(false);
      return setError(visit.data.error?.message ?? t('error'));
    }

    // La visita ya existe y no se deshace: de acá en adelante cada paso falla por separado y se dice cuál.
    const failed: string[] = [];
    if (photo) {
      const r = await postJson(`/api/visits/${visitId.current}/evidence`, { type: 'PHOTO', fileUrl: photo.url, fileHash: photo.hash });
      if (!r.ok) failed.push(t('photoFailed'));
    }
    if (variant === 'PAID') {
      const r = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': `visit-${visitId.current}` },
        body: JSON.stringify({ creditId: stop.creditId, amount, method: form.paymentMethodCode, visitId: visitId.current, notes: form.notes.trim() || undefined }),
      }).catch(() => null);
      if (!r?.ok) failed.push(t('payFailed'));
    }
    if (variant === 'PROMISE') {
      const r = await postJson('/api/agenda', {
        creditId: stop.creditId,
        type: AgendaItemType.PROMISE_TO_PAY,
        scheduledDate: form.promiseDate,
        timeMode: ScheduleTimeMode.LAPSE,
        timeSlot: AgendaTimeSlot.MORNING,
        details: { amount, promiseDate: form.promiseDate, paymentMethodCode: form.paymentMethodCode },
      });
      if (!r.ok) failed.push(t('promiseFailed'));
    }

    if (revisitOn) {
      // A nombre del responsable del crédito (lo decide la API): la visita nueva la hace quien lleva la cartera.
      const r = await postJson('/api/agenda', {
        creditId: stop.creditId,
        type: AgendaItemType.VISIT,
        scheduledDate: revisitDate,
        timeMode: ScheduleTimeMode.LAPSE,
        timeSlot: revisitSlot,
        details: stop.locationId ? { locationId: stop.locationId } : { customAddress: { address: stop.address!.trim() } },
      });
      if (!r.ok) failed.push(t('revisitFailed'));
    }

    setBusy(false);
    router.refresh();
    if (failed.length > 0) return setWarnings(failed);
    onClose();
  }

  const input = 'h-11 w-full rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';
  const label = 'mb-1.5 block text-[13px] font-medium text-k-text';

  return (
    <Modal
      wide
      open={open}
      onClose={() => !busy && onClose()}
      title={correctsVisitId ? t('titleFix') : t('title')}
      actions={
        warnings.length > 0 ? (
          <button type="button" onClick={onClose} className="h-10 rounded-xl bg-k-navy px-5 text-[14px] font-semibold text-white hover:bg-k-slate">
            {t('close')}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-50"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!ready || busy || !stop.creditId}
              className="h-10 rounded-xl bg-k-navy px-5 text-[14px] font-semibold text-white hover:bg-k-slate disabled:opacity-50"
            >
              {busy ? t('saving') : correctsVisitId ? t('submitFix') : t('submit')}
            </button>
          </>
        )
      }
    >
      <p className="text-[13px] text-k-text-2">
        <strong className="font-semibold text-k-text">{stop.clientName ?? '—'}</strong>
        {stop.address ? ` · ${stop.address}` : ''}
      </p>
      {!viewerIsCollector && (
        <p className="mt-2 rounded-lg border border-k-border bg-k-bg px-3 py-2 text-[13px] text-k-text-2">{t('onBehalf', { name: collectorName })}</p>
      )}
      {correctsVisitId && <p className="mt-2 rounded-lg border border-k-warning bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">{t('fixHint')}</p>}

      {warnings.length > 0 ? (
        <p role="alert" className="mt-4 rounded-xl border border-k-warning bg-k-warning-bg px-4 py-3 text-[14px] text-k-text">
          {t('partial', { what: warnings.join(` ${t('and')} `) })}
        </p>
      ) : (
        <>
          <fieldset className="mt-4">
            <legend className={label}>{t('result')}</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {VISIT_VARIANT_KEYS.map((key) => {
                const v = VARIANT_UI[key];
                const blocked = key === 'PAID' && !canPay;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={blocked}
                    aria-pressed={variant === key}
                    onClick={() => setVariant(key)}
                    title={blocked ? t('noPay') : undefined}
                    className={`flex flex-col items-center gap-2 rounded-xl border-2 px-2 py-3 text-center text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      variant === key ? `${v.ring} bg-white shadow-k-card` : 'border-k-border bg-white hover:bg-k-bg'
                    }`}
                  >
                    <span aria-hidden className={`grid h-9 w-9 place-items-center rounded-full ${v.tile}`}>
                      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d={v.path} />
                      </svg>
                    </span>
                    <span className="text-k-text">{t(`variants.${key}`)}</span>
                  </button>
                );
              })}
            </div>
            {!canPay && <p className="mt-2 text-[12px] text-k-muted">{t('noPay')}</p>}
          </fieldset>

          {variant && ui && (
            <div className="mt-5 space-y-4">
              {(variant === 'PAID' || variant === 'PROMISE') && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="rv-amount" className={label}>
                      {variant === 'PAID' ? t('amountPaid') : t('amountPromised')}
                    </label>
                    <input
                      id="rv-amount"
                      inputMode="decimal"
                      value={form.amount}
                      onChange={(e) => set('amount', e.target.value.replace(',', '.'))}
                      className={input}
                      placeholder="0.00"
                    />
                    {/*
                      * La cuota que correspondía pagar, **antes** del tope: es lo que el cobrador le pide a la persona; el
                      * total es solo hasta dónde se puede llegar. Sin dato de la cuota, no se muestra nada (nunca un 0).
                      */}
                    {stop.installmentAmount != null && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[12px] text-k-text-2">
                        <span>
                          {t('installmentHint', { amount: money(stop.installmentAmount, currency) })}
                          {stop.nextDueDate ? ` · ${t('installmentDue', { date: dayDate(stop.nextDueDate, locale) })}` : ''}
                        </span>
                        {form.amount !== String(stop.installmentAmount) && (
                          <button
                            type="button"
                            onClick={() => set('amount', String(stop.installmentAmount))}
                            className="font-medium text-k-periwinkle hover:underline"
                          >
                            {t('useInstallment')}
                          </button>
                        )}
                      </p>
                    )}
                    {cap != null && variant === 'PAID' && <p className="mt-1 text-[12px] text-k-muted">{t('capHint', { max: money(cap, currency) })}</p>}
                  </div>
                  {variant === 'PAID' ? (
                    <div>
                      <label htmlFor="rv-method" className={label}>
                        {t('method')}
                      </label>
                      <select id="rv-method" value={form.paymentMethodCode} onChange={(e) => set('paymentMethodCode', e.target.value)} className={input}>
                        {METHODS.map((m) => (
                          <option key={m} value={m}>
                            {tMethod(m)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div>
                      <label htmlFor="rv-date" className={label}>
                        {t('promiseDate')}
                      </label>
                      <input id="rv-date" type="date" min={today} value={form.promiseDate} onChange={(e) => set('promiseDate', e.target.value)} className={input} />
                    </div>
                  )}
                  {variant === 'PROMISE' && promiseMethods.length > 0 && (
                    <div>
                      <label htmlFor="rv-pmethod" className={label}>
                        {t('method')}
                      </label>
                      <select id="rv-pmethod" value={form.paymentMethodCode} onChange={(e) => set('paymentMethodCode', e.target.value)} className={input}>
                        {promiseMethods.map((m) => (
                          <option key={m.code} value={m.code}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {variant === 'NO_ANSWER' && (
                <div>
                  <span className={label}>{t('channel')}</span>
                  <div className="flex gap-2">
                    {(['CALL', 'DOOR'] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={form.channel === c}
                        onClick={() => set('channel', c)}
                        className={`h-10 rounded-xl border px-4 text-[14px] ${form.channel === c ? 'border-k-navy bg-k-navy text-white' : 'border-k-border bg-white text-k-text-2 hover:bg-k-bg'}`}
                      >
                        {t(`channels.${c}`)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {variant === 'NO_CONTACT_VISIT' && (
                <label className="flex items-center gap-2 text-[14px] text-k-text">
                  <input type="checkbox" checked={form.noticeLeft} onChange={(e) => set('noticeLeft', e.target.checked)} className="h-4 w-4 rounded border-k-border" />
                  {t('noticeLeft')}
                </label>
              )}

              {variant === 'SPECIAL' && (
                <div>
                  <label htmlFor="rv-cat" className={label}>
                    {t('category')}
                  </label>
                  {categories.length === 0 ? (
                    <p className="text-[13px] text-k-text-2">{t('noCategories')}</p>
                  ) : (
                    <select id="rv-cat" value={form.categoryCode} onChange={(e) => set('categoryCode', e.target.value)} className={input}>
                      <option value="">{t('chooseCategory')}</option>
                      {categories.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}

              {canRevisit && (
                <div className="rounded-xl border border-k-border bg-k-bg px-4 py-3">
                  <label className="flex items-center gap-2 text-[14px] font-medium text-k-text">
                    <input type="checkbox" checked={revisit} onChange={(e) => setRevisit(e.target.checked)} className="h-4 w-4 rounded border-k-border" />
                    {t('revisit')}
                  </label>
                  {revisit && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label htmlFor="rv-rdate" className={label}>
                          {t('revisitDate')}
                        </label>
                        <input id="rv-rdate" type="date" min={today} value={revisitDate} onChange={(e) => setRevisitDate(e.target.value)} className={input} />
                      </div>
                      <div>
                        <label htmlFor="rv-rslot" className={label}>
                          {t('revisitSlot')}
                        </label>
                        <select id="rv-rslot" value={revisitSlot} onChange={(e) => setRevisitSlot(e.target.value as AgendaTimeSlot)} className={input}>
                          {REVISIT_SLOTS.map((sl) => (
                            <option key={sl} value={sl}>
                              {t(`slots.${sl}`)}
                            </option>
                          ))}
                        </select>
                      </div>
                      <p className="text-[12px] text-k-muted sm:col-span-2">{t('revisitHint')}</p>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label htmlFor="rv-notes" className={label}>
                  {variant === 'WRONG_ADDRESS' ? t('notesRequired') : t('notes')}
                </label>
                <textarea
                  id="rv-notes"
                  rows={3}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  placeholder={t('notesPlaceholder')}
                  className="w-full rounded-xl border border-k-border bg-white px-3 py-2.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
                />
              </div>

              <div>
                <span className={label}>{t('evidence')}</span>
                <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void pickPhoto(e.target.files?.[0])} />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                    className="h-10 rounded-xl border border-dashed border-k-border bg-k-bg px-4 text-[13px] font-medium text-k-text-2 hover:bg-white disabled:opacity-60"
                  >
                    {uploading ? t('uploading') : photo ? t('photoReplace') : t('photoAdd')}
                  </button>
                  {photo && (
                    <span className="flex items-center gap-2 text-[13px] text-k-text-2">
                      <span className="max-w-[220px] truncate">{photo.name}</span>
                      <button type="button" onClick={() => setPhoto(null)} className="text-k-danger hover:underline">
                        {t('photoRemove')}
                      </button>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[12px] text-k-muted">{t('evidenceHint')}</p>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-k-danger bg-k-danger-bg px-3 py-2 text-[13px] text-k-text">
          {error}
        </p>
      )}
    </Modal>
  );
}
