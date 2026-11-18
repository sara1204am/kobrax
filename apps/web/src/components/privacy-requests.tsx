'use client';

import { useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Section } from '@/components/panel-ui';
import { Button, ErrorBanner, Field, Input } from '@/components/ui';
import { useToast } from '@/components/toast';
import { sendJson } from '@/lib/client';
import { dateTime } from '@/lib/format';
import { PRIVACY_REQUEST_TYPES, type PrivacyRequestView } from '@/lib/legal';

type Mode = 'self' | 'org';
type Status = PrivacyRequestView['status'];

const TONE: Record<Status, 'neutral' | 'success' | 'warning' | 'danger'> = {
  RECEIVED: 'neutral',
  IN_REVIEW: 'neutral',
  NEEDS_INFO: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  COMPLETED: 'success',
};

const FIELD =
  'block w-full rounded-lg border border-k-border bg-white px-3 py-2 text-k-base text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus';

/**
 * Solicitudes de derechos de las personas (privacidad · B6), para los dos casos que NO se mezclan:
 *  - `self` (Mi perfil › Privacidad): la persona pide acceso/corrección/eliminación… sobre SUS datos y sigue los pasos; las atiende Kobrax.
 *  - `org` (Cuenta › Privacidad): el personal de la organización registra la solicitud de un titular de cobranza y le da seguimiento.
 *    La organización es la RESPONSABLE: Kobrax solo ofrece la herramienta, y quien administra la cuenta no consiente por los titulares.
 *
 * El servidor decide qué cambios de estado son válidos (`allowedNext`): la pantalla solo ofrece esos. Rechazar exige justificación y
 * pedir información exige decir qué falta. Nada se borra ni se ejecuta solo: «Completada» la marca una persona tras hacer el trabajo.
 */
export function PrivacyRequests({ mode, initial }: { mode: Mode; initial: PrivacyRequestView[] }) {
  const t = useTranslations('privacy.requests');
  const toast = useToast();
  const base = mode === 'org' ? '/api/privacy/requests/org' : '/api/privacy/requests';
  const [items, setItems] = useState(initial);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PrivacyRequestView['type']>('ACCESS');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = description.trim().length >= 10 && (mode === 'self' || subject.trim().length >= 2);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    const body = mode === 'org' ? { type, subjectLabel: subject.trim(), description: description.trim() } : { type, description: description.trim() };
    const res = await sendJson<PrivacyRequestView>(base, body, 'POST');
    setSaving(false);
    if (!res.ok) {
      const code = (res.data as { error?: { code?: string } }).error?.code;
      setError(code === 'PRIVACY_REQUEST_TOO_MANY_OPEN' ? t('errorTooMany') : t('error'));
      return;
    }
    setItems((cur) => [res.data, ...cur]);
    setOpen(false);
    setSubject('');
    setDescription('');
    toast(t('created'));
  }

  return (
    <Section
      title={t(`${mode}.title`)}
      description={t(`${mode}.text`)}
      inner="p-4"
      action={
        !open && (
          <Button type="button" variant="primary" className="!h-10 !w-auto px-4 !text-k-sm" onClick={() => setOpen(true)}>
            {t('new')}
          </Button>
        )
      }
    >
      {open && (
        <form onSubmit={create} className="mb-4 space-y-3 rounded-xl border border-k-border bg-k-bg p-4">
          <ErrorBanner message={error} />
          <Field label={t('type')}>
            <select value={type} onChange={(e) => setType(e.target.value as PrivacyRequestView['type'])} className={FIELD}>
              {PRIVACY_REQUEST_TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`types.${x}`)}
                </option>
              ))}
            </select>
          </Field>
          {mode === 'org' && (
            <Field label={t('subject')} hint={t('subjectHint')}>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
            </Field>
          )}
          <Field label={t('description')} hint={t('descriptionHint')}>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} className={FIELD} />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" className="!w-auto px-4" onClick={() => setOpen(false)} disabled={saving}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit" variant="primary" className="!w-auto px-5" loading={saving} disabled={!valid}>
              {t(mode === 'org' ? 'submitOrg' : 'submit')}
            </Button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <p className="text-k-sm text-k-text-2">{t('empty')}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              mode={mode}
              onChange={(next) => setItems((cur) => cur.map((x) => (x.id === next.id ? next : x)))}
            />
          ))}
        </ul>
      )}
      <p className="mt-4 text-k-xs text-k-muted">{t('limits')}</p>
    </Section>
  );
}

function RequestCard({ request: r, mode, onChange }: { request: PrivacyRequestView; mode: Mode; onChange: (r: PrivacyRequestView) => void }) {
  const t = useTranslations('privacy.requests');
  const toast = useToast();
  /** Estado al que se está por pasar y que necesita texto (rechazar / pedir información). */
  const [pending, setPending] = useState<Status | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsText = (s: Status) => s === 'REJECTED' || s === 'NEEDS_INFO';
  const minOk = text.trim().length >= 5;

  async function move(status: Status, note?: string) {
    setBusy(true);
    setError(null);
    const body =
      status === 'REJECTED' ? { status, rejectionReason: note } : { status, ...(note ? { note } : {}) };
    const res = await sendJson<PrivacyRequestView>(`/api/privacy/requests/org/${r.id}/status`, body, 'PATCH');
    setBusy(false);
    if (!res.ok) {
      setError(t('error'));
      return;
    }
    onChange(res.data);
    setPending(null);
    setText('');
    toast(t(`statuses.${status}`));
  }

  return (
    <li className="rounded-xl border border-k-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-k-base font-semibold text-k-text">
          {t(`types.${r.type}`)}
          {r.subjectLabel && <span className="font-normal text-k-text-2"> · {r.subjectLabel}</span>}
        </p>
        <Badge tone={TONE[r.status]} dot>
          {t(`statuses.${r.status}`)}
        </Badge>
      </div>
      <p className="mt-1 text-k-sm text-k-text-2">{r.description}</p>
      {r.status === 'REJECTED' && r.rejectionReason && (
        <p className="mt-2 rounded-lg bg-k-danger-bg px-3 py-2 text-k-sm text-k-danger">{t('rejection', { reason: r.rejectionReason })}</p>
      )}

      <div className="mt-3 border-t border-k-border pt-3">
        <p className="mb-1 text-k-2xs font-semibold uppercase tracking-wide text-k-muted">{t('timeline')}</p>
        <ol className="space-y-1 text-[12.5px] text-k-text-2">
          {r.events.map((e, i) => (
            <li key={i}>
              <span className="font-medium text-k-text">{t(`statuses.${e.status as Status}`)}</span> · {dateTime(e.createdAt)} ·{' '}
              {t(`actors.${e.actorKind}`)}
              {e.note && <span className="block pl-3 text-k-text-2">“{e.note}”</span>}
            </li>
          ))}
        </ol>
      </div>

      {mode === 'org' && r.allowedNext.length > 0 && (
        <div className="mt-3 space-y-2 border-t border-k-border pt-3">
          {error && <ErrorBanner message={error} />}
          {pending ? (
            <div className="space-y-2">
              <Field label={pending === 'REJECTED' ? t('actions.reason') : needsText(pending) ? t('actions.needNote') : t('actions.note')}>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} className={FIELD} />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" className="!h-9 !w-auto px-3 !text-k-sm" onClick={() => { setPending(null); setText(''); }} disabled={busy}>
                  {t('actions.cancel')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  className="!h-9 !w-auto px-4 !text-k-sm"
                  loading={busy}
                  disabled={needsText(pending) && !minOk}
                  onClick={() => void move(pending, text.trim() || undefined)}
                >
                  {t('actions.confirm')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {r.allowedNext.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant="ghost"
                  className="!h-9 !w-auto px-3 !text-k-sm"
                  disabled={busy}
                  onClick={() => (needsText(s) ? setPending(s) : void move(s))}
                >
                  {t(`actions.${s as Exclude<Status, 'RECEIVED'>}`)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
