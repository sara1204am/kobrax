'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import type { MoraAssignment } from '@kobrax/shared';
import { Modal } from '@/components/modal';
import { Badge, Section } from '@/components/panel-ui';
import { useToast } from '@/components/toast';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';
import { dayDate, todayIso } from '@/lib/format';

export interface Person {
  userId: string;
  name: string;
}

type Dialog = 'support' | 'temporary' | null;

/** El fin del día elegido, en hora local, como instante: «vence el 10/10» vence al terminar el 10, no a las 00:00. */
const endOfDay = (iso: string) => new Date(`${iso}T23:59:59`).toISOString();

/**
 * **Quién atiende el crédito** (F4/08 · D8): el responsable, el reemplazo temporal (con vencimiento) y la ayuda.
 *
 * 🔴 **Los tres ven y trabajan el crédito**; sólo el responsable es «el dueño». Quien tiene `assignment:write`
 * (supervisor de la agencia, gerente, administrador) puede **agregar una ayuda**, **cambiar temporalmente** o
 * **quitar** una cobertura — el responsable no se quita, se reasigna desde Cartera. Quien no tiene el permiso ve
 * la lista y ninguna acción.
 *
 * 🔴 **Sin nombre no se muestra el id**: `/users` da 403 sin `user:read`, y quien fue dado de baja puede faltar.
 * Se resuelve contra `people` (equipo y lista de asignables); si no está, «Asignado».
 */
export function ResponsiblesSection({
  creditId,
  assignments,
  people,
  collectors,
  canAssign,
}: {
  creditId: string;
  assignments: MoraAssignment[];
  /** Para poner nombre: el equipo y quien dejó asignar el servidor. */
  people: Person[];
  /** A quién se puede asignar (`GET /assignments/assignees`). */
  collectors: Person[];
  /** `assignment:write`. */
  canAssign: boolean;
}) {
  const t = useTranslations('panel.mora');
  const tr = useTranslations('panel.mora.gestion.responsibles');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [userId, setUserId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const nameOf = (id: string) => people.find((p) => p.userId === id)?.name ?? tr('unknown');
  const principal = assignments.find((a) => a.kind === 'PRINCIPAL');
  const covers = assignments.filter((a) => a.kind !== 'PRINCIPAL');

  function close() {
    setDialog(null);
    setUserId('');
    setExpiresAt('');
    setReason('');
    setError(null);
    setTouched(false);
  }

  async function save() {
    setTouched(true);
    // El reemplazo temporal exige vencimiento; la ayuda lo trae opcional.
    if (!userId || (dialog === 'temporary' && !expiresAt)) return;
    setBusy(true);
    setError(null);
    const res =
      dialog === 'temporary'
        ? await sendJson('/api/assignments/temporary', {
            creditId,
            userId,
            expiresAt: endOfDay(expiresAt),
            ...(reason.trim() ? { reason: reason.trim() } : {}),
          })
        : await sendJson('/api/assignments/support', { creditId, userId, ...(expiresAt ? { expiresAt: endOfDay(expiresAt) } : {}) });
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    toast(dialog === 'temporary' ? tr('tempDone') : tr('supportDone'));
    close();
    router.refresh();
  }

  async function remove(id: string) {
    setBusy(true);
    const res = await sendJson(`/api/assignments/${id}`, {}, 'DELETE');
    setBusy(false);
    if (!res.ok) {
      toast(errorText(res.data.error, t, locale), 'danger');
      return;
    }
    toast(tr('removed'));
    router.refresh();
  }

  const missing = touched && (!userId || (dialog === 'temporary' && !expiresAt));

  return (
    <Section title={tr('title')}>
      <p className="mb-3 text-[13px] text-k-text-2">{tr('hint')}</p>
      <ul className="space-y-2">
        <li className="flex flex-wrap items-center gap-2">
          <Badge tone="neutral">{tr('PRINCIPAL')}</Badge>
          <span className="text-[14px] font-medium text-k-text">{principal ? nameOf(principal.userId) : tr('none')}</span>
        </li>
        {covers.map((a) => (
          <li key={a.id ?? `${a.kind}-${a.userId}`} className="flex flex-wrap items-center gap-2">
            <Badge tone={a.kind === 'TEMPORAL' ? 'warning' : 'neutral'}>{tr(a.kind)}</Badge>
            <span className="text-[14px] font-medium text-k-text">{nameOf(a.userId)}</span>
            {a.expiresAt && <span className="text-[13px] text-k-text-2">{tr('expires', { date: dayDate(a.expiresAt.slice(0, 10), locale) })}</span>}
            {canAssign && a.id && (
              <button
                type="button"
                onClick={() => void remove(a.id!)}
                disabled={busy}
                className="text-[13px] font-medium text-k-danger hover:underline disabled:opacity-50"
              >
                {tr('remove')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {canAssign && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => setDialog('support')} className="sm:w-auto sm:px-5">
            {tr('addSupport')}
          </Button>
          <Button variant="ghost" onClick={() => setDialog('temporary')} className="sm:w-auto sm:px-5">
            {tr('changeTemp')}
          </Button>
        </div>
      )}

      <Modal
        open={dialog !== null}
        onClose={close}
        title={dialog === 'temporary' ? tr('tempTitle') : tr('supportTitle')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {tr('cancel')}
            </Button>
            <Button onClick={save} loading={busy} className="sm:w-auto sm:px-5">
              {tr('confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{dialog === 'temporary' ? tr('tempText') : tr('supportText')}</p>
        <div className="mt-4 space-y-4">
          <Field label={tr('collector')}>
            <Select value={userId} onChange={(e) => setUserId(e.target.value)} disabled={busy}>
              <option value="">{tr('collectorPlaceholder')}</option>
              {collectors.map((c) => (
                <option key={c.userId} value={c.userId}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={dialog === 'temporary' ? tr('expiresAt') : tr('expiresOptional')}>
            <Input type="date" min={todayIso()} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} disabled={busy} />
          </Field>
          {dialog === 'temporary' && (
            <Field label={tr('reason')}>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={300} />
            </Field>
          )}
          {missing && <ErrorBanner message={tr('needsData')} />}
        </div>
      </Modal>
    </Section>
  );
}
