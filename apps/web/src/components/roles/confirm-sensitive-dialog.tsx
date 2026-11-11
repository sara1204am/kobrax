'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ROLE_REASON_MIN_LENGTH, type RoleUpdateResult } from '@kobrax/shared';
import { Modal } from '@/components/modal';
import { sendJson } from '@/lib/client';
import { errorText, type ApiError } from '@/lib/api-error';
import { permissionKey, type ChangeSummary } from '@/lib/roles';

export interface RoleSaveFailure {
  message: string;
  code?: string;
  /** Permisos señalados por el servidor como causa del rechazo (la pantalla los resalta). */
  flagged: string[];
}

/**
 * Confirmar un cambio de permisos (vista F del plan). Siempre pide el motivo (D-4), cuenta a cuántas personas afecta, destaca el riesgo alto
 * y, si el servidor rechaza, muestra el motivo SIN cerrar y devuelve los permisos implicados para resaltarlos.
 */
export function ConfirmSensitiveDialog({
  open,
  onClose,
  roleKey,
  roleName,
  members,
  expectedVersion,
  desired,
  summary,
  mode = 'save',
  onSaved,
  onFailed,
}: {
  open: boolean;
  onClose: () => void;
  roleKey: string;
  roleName: string;
  members: number;
  expectedVersion: number;
  /** Sólo en `save`: el conjunto completo que tendrá el rol. */
  desired?: string[];
  summary: ChangeSummary;
  /** `restore` = volver a la plantilla (mismo motivo, misma versión, mismo rastro). */
  mode?: 'save' | 'restore';
  onSaved: (result: RoleUpdateResult) => void;
  onFailed: (failure: RoleSaveFailure) => void;
}) {
  const t = useTranslations('roles');
  const tp = useTranslations('permissions');
  const locale = useLocale();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setConflict(false);
    }
  }, [open]);

  const valid = reason.trim().length >= ROLE_REASON_MIN_LENGTH;
  const name = (code: string) => tp(`${permissionKey(code)}.name`);

  async function confirm() {
    setBusy(true);
    setError(null);
    const base = `/api/roles/${encodeURIComponent(roleKey)}`;
    const { ok, status, data } = await sendJson<RoleUpdateResult>(
      mode === 'restore' ? `${base}/restore-template` : `${base}/permissions`,
      mode === 'restore' ? { expectedVersion, reason: reason.trim() } : { permissions: desired, expectedVersion, reason: reason.trim() },
      mode === 'restore' ? 'POST' : 'PUT',
    );
    setBusy(false);
    if (ok) {
      onSaved(data as RoleUpdateResult);
      return;
    }
    const err = (data as { error?: ApiError & { details?: { violations?: { permissions: string[] }[] } } }).error;
    const message = errorText(err ? { code: err.code, message: err.message } : undefined, t as never, locale);
    setError(message);
    setConflict(status === 409);
    onFailed({ message, code: err?.code, flagged: (err?.details?.violations ?? []).flatMap((v) => v.permissions) });
  }

  return (
    <Modal
      open={open}
      onClose={() => !busy && onClose()}
      locked={busy}
      title={mode === 'restore' ? t('detail.restoreTitle', { name: roleName }) : t('confirm.title', { name: roleName })}
      actions={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-10 rounded-xl border border-k-border bg-white px-4 text-[14px] font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-50"
          >
            {t('confirm.cancel')}
          </button>
          {conflict ? (
            <button type="button" onClick={() => window.location.reload()} className="h-10 rounded-xl bg-k-navy px-5 text-[14px] font-semibold text-white hover:bg-k-slate">
              {t('errors.reload')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || !valid}
              className="h-10 rounded-xl bg-k-navy px-5 text-[14px] font-semibold text-white hover:bg-k-slate disabled:opacity-50"
            >
              {mode === 'restore' ? t('detail.restoreConfirm') : t('confirm.confirm')}
            </button>
          )}
        </>
      }
    >
      <p className="mb-3">{members > 0 ? t('confirm.affects', { n: members }) : t('confirm.affectsNone')}</p>

      {summary.highRiskAdded.length > 0 && (
        <p role="note" className="mb-3 rounded-lg border border-k-warning bg-k-warning-bg px-3 py-2 text-[13px] text-k-warning-text">
          ⚠ {t('confirm.highRisk', { list: summary.highRiskAdded.map(name).join(', ') })}
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-k-muted">{t('confirm.added')}</p>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-k-text">{summary.added.length ? summary.added.map((c) => <li key={c}>{name(c)}</li>) : <li className="list-none text-k-muted">—</li>}</ul>
        </div>
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-k-muted">{t('confirm.removed')}</p>
          <ul className="mt-1 list-disc pl-5 text-[13px] text-k-text">{summary.removed.length ? summary.removed.map((c) => <li key={c}>{name(c)}</li>) : <li className="list-none text-k-muted">—</li>}</ul>
        </div>
      </div>

      <label htmlFor="role-reason" className="mb-1.5 block text-[13px] font-medium text-k-text">
        {t('confirm.reasonLabel')}
      </label>
      <textarea
        id="role-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        maxLength={500}
        rows={3}
        placeholder={t('confirm.reasonPlaceholder')}
        className="w-full rounded-xl border border-k-border bg-white px-3 py-2.5 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
      />
      <p className="mt-1 text-[12px] text-k-muted">{t('confirm.reasonHint', { n: ROLE_REASON_MIN_LENGTH })}</p>
      <p className="mt-2 text-[12px] text-k-muted">{t('confirm.safe')}</p>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-k-danger bg-k-danger-bg px-3 py-2 text-[13px] text-k-text">
          {error}
        </p>
      )}
    </Modal>
  );
}
