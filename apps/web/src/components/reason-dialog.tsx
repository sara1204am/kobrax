'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { isValidReason, ROUTE_REASON_MAX } from '@kobrax/shared';
import { Modal } from '@/components/modal';

/**
 * Un diálogo que pide **el motivo escrito** antes de hacer algo que lo exige: cancelar una ruta, cerrarla con paradas
 * sin gestionar, tocar la de otra persona, pedir un cambio (F4/12).
 *
 * El motivo vale si dice algo (`isValidReason`, el mismo criterio que aplica la API): un punto o dos letras no son un
 * motivo. `onConfirm` devuelve el mensaje de error del servidor, o `null` si salió bien — y entonces se cierra.
 *
 * 🔴 Con `required={false}` el motivo es opcional (aprobar un pedido: la nota es de cortesía), pero si se escribe algo
 * se manda igual.
 */
export function ReasonDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  tone = 'primary',
  required = true,
  label,
  placeholder,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  /** El texto que explica QUÉ va a pasar: sin él, el motivo se pide a ciegas. */
  children?: ReactNode;
  confirmLabel: string;
  /** `danger` para lo que no se deshace (cancelar). */
  tone?: 'primary' | 'danger';
  required?: boolean;
  label?: string;
  placeholder?: string;
  onConfirm: (reason: string) => Promise<string | null>;
}) {
  const t = useTranslations('panel.routes.actions');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Un diálogo que se vuelve a abrir no arrastra el motivo ni el error del intento anterior.
  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
    }
  }, [open]);

  const valid = required ? isValidReason(reason) : reason.trim().length === 0 || isValidReason(reason);

  async function confirm() {
    setBusy(true);
    setError(null);
    const failed = await onConfirm(reason.trim());
    setBusy(false);
    if (failed) return setError(failed);
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      title={title}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-50"
          >
            {t('back')}
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={busy || !valid}
            className={`h-10 rounded-xl px-5 text-[14px] font-semibold text-white disabled:opacity-50 ${
              tone === 'danger' ? 'bg-k-danger hover:brightness-110' : 'bg-k-navy hover:bg-k-slate'
            }`}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children && <div className="mb-4">{children}</div>}
      <label htmlFor="reason" className="mb-1.5 block text-[13px] font-medium text-k-text">
        {label ?? t('reasonLabel')}
      </label>
      <textarea
        id="reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={ROUTE_REASON_MAX}
        rows={3}
        placeholder={placeholder ?? t('reasonPlaceholder')}
        className="w-full rounded-xl border border-k-border bg-white px-3 py-2.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
      />
      {required && <p className="mt-1 text-[12px] text-k-muted">{t('reasonHint')}</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-k-danger bg-k-danger-bg px-3 py-2 text-[13px] text-k-text">
          {error}
        </p>
      )}
    </Modal>
  );
}
