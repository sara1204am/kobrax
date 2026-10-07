'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { AGENDA_OUTCOMES_BY_TYPE, ScheduleTimeMode, type AgendaItemType, type AgendaListItem } from '@kobrax/shared';
import { Button, ErrorBanner, Field, Input, Select } from '@/components/ui';
import { Modal } from '@/components/modal';
import { useToast } from '@/components/toast';
import { shiftDay } from '@/lib/agenda';
import { errorText } from '@/lib/api-error';
import { sendJson } from '@/lib/client';
import { NewTaskModal } from '../new-task-modal';
import type { CatalogOption } from './page';

type Action = 'complete' | 'cancel' | 'reschedule' | 'delete' | null;

/**
 * Lo que se puede hacer con una gestión pendiente.
 *
 * Los tres caminos cierran el día de formas distintas y ninguno borra nada: ejecutar deja además
 * una gestión en el historial del crédito, cancelar la deja visible con su estado, y reagendar cierra ésta
 * como reagendada y **crea otra** — el día viejo conserva el rastro.
 */
export function ItemActions({
  itemId,
  type,
  initialAction,
  today,
  cancelReasons,
  rescheduleReasons,
  canExecute,
  routeStopHref,
  editable,
  schedule,
  assign,
}: {
  itemId: string;
  type: AgendaItemType;
  /** El diálogo que se abre de entrada (`?accion=` del menú de la lista). */
  initialAction?: 'complete' | 'reschedule' | 'cancel' | 'edit' | 'delete';
  /** Hoy, en `YYYY-MM-DD` UTC. Lo calcula el servidor: el reloj del navegador puede estar corrido. */
  today: string;
  cancelReasons: CatalogOption[];
  rescheduleReasons: CatalogOption[];
  /** Registrar la ejecución, reagendar y cancelar: de quien atiende la gestión (o su supervisor). */
  canExecute: boolean;
  /** La parada de ruta que lleva esta visita: «Registrar la ejecución» pasa a ser un enlace a ella. */
  routeStopHref?: string;
  /**
   * Editar y eliminar: SOLO si quien mira es quien creó la gestión (lo decide la página con `createdBy`).
   * Llega la gestión entera para precargar el formulario.
   */
  editable?: AgendaListItem;
  /** Cuándo está agendada hoy: reagendar arranca con la MISMA hora o franja (cambiar el día no es cambiar la hora). */
  schedule: { timeMode: ScheduleTimeMode; scheduledTime?: string; timeSlot?: string };
  /** Quien puede asignar (`agenda:assign`) ve el campo «Responsable» al editar y puede reasignar. */
  assign?: { meId: string };
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const router = useRouter();
  const toast = useToast();

  // `edit` no es un diálogo de acá sino el modal del formulario: arranca abierto si se pidió desde el menú de la lista.
  const [action, setAction] = useState<Action>(initialAction && initialAction !== 'edit' && (initialAction !== 'delete' || editable) ? initialAction : null);
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  /*
   * Mañana, contado desde HOY y no desde el día del ítem. Con el día del ítem, reagendar una
   * gestión vencida proponía una fecha ya pasada y la API la rechazaba siempre (`AGENDA_003`) —
   * justo en el caso más común, porque las vencidas son las que la pantalla promociona.
   */
  const tomorrow = shiftDay(today, 1);
  const [newDate, setNewDate] = useState(tomorrow);
  const [rMode, setRMode] = useState<ScheduleTimeMode>(schedule.timeMode === ScheduleTimeMode.FIXED && schedule.scheduledTime ? ScheduleTimeMode.FIXED : ScheduleTimeMode.LAPSE);
  const [rTime, setRTime] = useState(schedule.scheduledTime ?? '09:00');
  const [rSlot, setRSlot] = useState(schedule.timeSlot ?? 'MORNING');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialAction === 'edit' && !!editable);

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

  /** Eliminar quita la gestión: el detalle ya no existe, así que se vuelve a la agenda (no se refresca un 404). */
  async function remove() {
    setError(null);
    setBusy(true);
    const res = await sendJson(`/api/agenda/${itemId}`, undefined, 'DELETE');
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
      return;
    }
    close();
    toast(t('deleteItem.done'));
    router.push('/agenda');
    router.refresh();
  }

  async function send(path: string, body: unknown, done: string) {
    setError(null);
    setBusy(true);
    const res = await sendJson(path, body);
    setBusy(false);
    if (!res.ok) {
      setError(errorText(res.data.error, t, locale));
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
      {canExecute && (
        <>
          {routeStopHref ? (
            <a href={routeStopHref} className="contents">
              <Button type="button" className="sm:w-auto sm:px-6">
                {t('actions.openRoute')}
              </Button>
            </a>
          ) : (
            <Button onClick={() => setAction('complete')} className="sm:w-auto sm:px-6">
              {t('actions.complete')}
            </Button>
          )}
          <Button variant="ghost" onClick={() => setAction('reschedule')} className="sm:w-auto sm:px-6">
            {t('actions.reschedule')}
          </Button>
          <Button variant="ghost" onClick={() => setAction('cancel')} className="sm:w-auto sm:px-6">
            {t('actions.cancel')}
          </Button>
        </>
      )}
      {editable && (
        <>
          <Button variant="ghost" onClick={() => setEditing(true)} className="sm:w-auto sm:px-6">
            {t('actions.edit')}
          </Button>
          <Button variant="ghost" onClick={() => setAction('delete')} className="sm:w-auto sm:px-6">
            {t('actions.delete')}
          </Button>
        </>
      )}

      {/* Se monta al abrir: el borrador arranca limpio cada vez, con lo guardado. */}
      {editable && editing && (
        <NewTaskModal open onClose={() => setEditing(false)} date={editable.scheduledDate.slice(0, 10)} editing={editable} assign={assign} />
      )}

      <Modal
        open={action === 'delete'}
        onClose={close}
        title={t('deleteItem.title')}
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy} className="sm:w-auto sm:px-5">
              {t('deleteItem.back')}
            </Button>
            <Button onClick={() => void remove()} loading={busy} className="sm:w-auto sm:px-5">
              {t('deleteItem.confirm')}
            </Button>
          </>
        }
      >
        <ErrorBanner message={error} />
        <p>{t('deleteItem.text')}</p>
      </Modal>

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
                  // Conserva la hora exacta o la franja que tenía: antes se mandaba siempre «Mañana» y una cita a las
                  // 15:30 quedaba como «por la mañana» sin avisar.
                  { scheduledDate: newDate, timeMode: rMode, ...(rMode === ScheduleTimeMode.FIXED ? { scheduledTime: rTime } : { timeSlot: rSlot }), reasonCode },
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
            {/* `min` en hoy: el calendario del navegador ni siquiera ofrece una fecha que el
                servidor va a rechazar. */}
            <Input
              type="date"
              min={today}
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              disabled={busy}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('create.timeMode')}>
              <Select value={rMode} onChange={(e) => setRMode(e.target.value as ScheduleTimeMode)} disabled={busy}>
                <option value={ScheduleTimeMode.LAPSE}>{t('create.modeLapse')}</option>
                <option value={ScheduleTimeMode.FIXED}>{t('create.modeFixed')}</option>
              </Select>
            </Field>
            {rMode === ScheduleTimeMode.FIXED ? (
              <Field label={t('create.time')}>
                <Input type="time" value={rTime} onChange={(e) => setRTime(e.target.value)} disabled={busy} />
              </Field>
            ) : (
              <Field label={t('create.slot')}>
                <Select value={rSlot} onChange={(e) => setRSlot(e.target.value)} disabled={busy}>
                  {['MORNING', 'AFTERNOON', 'NIGHT'].map((slot) => (
                    <option key={slot} value={slot}>
                      {t(`timeSlot.${slot}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
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
