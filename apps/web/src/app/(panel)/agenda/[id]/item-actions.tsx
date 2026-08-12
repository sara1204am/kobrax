'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AGENDA_OUTCOMES_BY_TYPE, ScheduleTimeMode, type AgendaItemType } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { shiftDay } from '@/lib/agenda';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';
import type { CatalogOption } from './page';

type Action = 'complete' | 'cancel' | 'reschedule' | null;

/**
 * Lo que se puede hacer con una gestión pendiente.
 *
 * Los tres caminos cierran el día de formas distintas y ninguno borra nada: ejecutar deja además
 * un `CaseActivity` en el caso, cancelar la deja visible con su estado, y reagendar cierra ésta
 * como reagendada y **crea otra** — el día viejo conserva el rastro.
 */
export function ItemActions({
  itemId,
  type,
  day,
  cancelReasons,
  rescheduleReasons,
}: {
  itemId: string;
  type: AgendaItemType;
  day: string;
  cancelReasons: CatalogOption[];
  rescheduleReasons: CatalogOption[];
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  const [action, setAction] = useState<Action>(null);
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [newDate, setNewDate] = useState(() => shiftDay(day, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Los desenlaces válidos dependen del TIPO, y la API rechaza los demás con AGENDA_007: una
  // visita no puede terminar en «el número no es del deudor».
  const outcomes = AGENDA_OUTCOMES_BY_TYPE[type] ?? [];

  function close() {
    setAction(null);
    setError(null);
    setOutcome('');
    setNotes('');
    setReasonCode('');
  }

  async function send(path: string, body: unknown, done: string) {
    setError(null);
    setBusy(true);
    const res = await sendJson(path, body);
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale) || t('errors.generic'));
      return;
    }
    close();
    toast(done);
    /*
     * ⚠️ Reagendar devuelve la gestión NUEVA, no ésta. Se refresca la que se está mirando —que
     * ahora dice «Reagendada»— en vez de saltar a la otra: irse solo a un id distinto haría
     * parecer que la de hoy se movió, y lo que pasó es que quedó cerrada acá y nació otra allá.
     */
    router.refresh();
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setAction('complete')} className="sm:w-auto sm:px-5">
        {t('actions.complete')}
      </Button>
      <Button variant="ghost" onClick={() => setAction('reschedule')} className="sm:w-auto sm:px-5">
        {t('actions.reschedule')}
      </Button>
      <Button variant="ghost" onClick={() => setAction('cancel')} className="sm:w-auto sm:px-5">
        {t('actions.cancel')}
      </Button>

      <Modal
        open={action === 'complete'}
        onClose={close}
        title={t('complete.title')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {t('complete.cancel')}
            </Button>
            <Button
              onClick={() =>
                send(`/api/agenda/${itemId}/complete`, { outcome, notes: notes.trim() || undefined }, t('complete.done'))
              }
              loading={busy}
              disabled={!outcome}
              className="sm:w-auto sm:px-5"
            >
              {t('complete.confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <div className="space-y-4">
          <Field label={t('complete.outcome')}>
            <Select value={outcome} onChange={(e) => setOutcome(e.target.value)} disabled={busy}>
              <option value="">—</option>
              {outcomes.map((value) => (
                <option key={value} value={value}>
                  {t(`outcome.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('complete.notes')}>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} maxLength={1000} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={action === 'reschedule'}
        onClose={close}
        title={t('reschedule.title')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {t('reschedule.cancel')}
            </Button>
            <Button
              onClick={() =>
                send(
                  `/api/agenda/${itemId}/reschedule`,
                  // La franja se manda porque el DTO exige un `timeMode`; la hora exacta la
                  // vuelve a poner quien ejecute, que es quien sabe a qué hora puede ir.
                  { scheduledDate: newDate, timeMode: ScheduleTimeMode.LAPSE, timeSlot: 'MORNING', reasonCode },
                  t('reschedule.done'),
                )
              }
              loading={busy}
              disabled={!reasonCode || !newDate}
              className="sm:w-auto sm:px-5"
            >
              {t('reschedule.confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('reschedule.text')}</p>
        <div className="mt-4 space-y-4">
          <Field label={t('reschedule.date')}>
            <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} disabled={busy} />
          </Field>
          <ReasonField
            label={t('reschedule.reason')}
            options={rescheduleReasons}
            value={reasonCode}
            onChange={setReasonCode}
            disabled={busy}
          />
        </div>
      </Modal>

      <Modal
        open={action === 'cancel'}
        onClose={close}
        title={t('cancelItem.title')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {t('cancelItem.back')}
            </Button>
            <Button
              onClick={() => send(`/api/agenda/${itemId}/cancel`, { reasonCode }, t('cancelItem.done'))}
              loading={busy}
              disabled={!reasonCode}
              className="sm:w-auto sm:px-5"
            >
              {t('cancelItem.confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('cancelItem.text')}</p>
        <div className="mt-4">
          <ReasonField
            label={t('cancelItem.reason')}
            options={cancelReasons}
            value={reasonCode}
            onChange={setReasonCode}
            disabled={busy}
          />
        </div>
      </Modal>
    </>
  );
}

/**
 * Los motivos salen del catálogo del tenant y **no se traducen**: los escribe la empresa, son
 * suyos. Sin `catalog:read` la lista viene vacía, y decirlo es más honesto que un desplegable que
 * no se puede abrir.
 */
function ReasonField({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: CatalogOption[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations('panel.agenda');
  return (
    <Field label={label}>
      {options.length > 0 ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          <option value="">—</option>
          {options.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <p className="text-[13px] text-k-text-2">{t('noReasons')}</p>
      )}
    </Field>
  );
}
