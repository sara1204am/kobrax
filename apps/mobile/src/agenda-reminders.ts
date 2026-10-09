import { AgendaItemStatus, type AgendaListItem } from '@kobrax/shared';

/**
 * Qué recordatorios locales programa el teléfono para lo agendado (F4/11 · E6, decisión D4).
 *
 * Es la parte PURA —qué se avisa y a qué hora—, sin tocar el sistema de notificaciones: así se prueba sin teléfono y la hora
 * no depende de nada que no se vea acá.
 *
 * Reglas:
 *  · **Hora fija** → un aviso 15 minutos antes («Llamada con Ana en 15 min»).
 *  · **Franja** (mañana, tarde, noche) → un aviso al empezar la franja. Antes las gestiones por franja no avisaban nunca:
 *    no tienen hora, así que el aviso es el comienzo de su franja (08:00, 13:00, 18:00).
 *  · Solo pendientes, y solo lo que todavía no pasó: un aviso en el pasado no avisa de nada.
 *  · Un tope: iOS guarda a lo sumo 64 notificaciones programadas, y las más cercanas son las que importan.
 *
 * 🔴 Las horas son **de pared del teléfono** (la hora de la gestión es «las 15:30» de ese día, sin zona): se arma la fecha con
 * los números del día y la hora, no sumando milisegundos a UTC.
 */

/** Cuánto antes de una gestión con hora fija se avisa. */
export const REMINDER_LEAD_MINUTES = 15;
/** Cuándo empieza cada franja, en minutos desde la medianoche (el mismo criterio que usa el servidor para posponer). */
export const SLOT_START_MINUTES: Record<string, number> = { MORNING: 8 * 60, AFTERNOON: 13 * 60, NIGHT: 18 * 60 };
/** Techo de recordatorios programados a la vez (iOS admite 64; se deja margen para otros avisos). */
export const MAX_REMINDERS = 50;

const TYPE_PHRASE: Record<string, string> = {
  CALL: 'Llamada',
  VISIT: 'Visita',
  WHATSAPP: 'WhatsApp',
  REMINDER: 'Recordatorio',
  PROMISE_TO_PAY: 'Promesa de pago',
};
const SLOT_PHRASE: Record<string, string> = { MORNING: 'por la mañana', AFTERNOON: 'por la tarde', NIGHT: 'por la noche' };

export interface PlannedReminder {
  /** `agenda:<id de la gestión>`: con ese id se reemplaza o se cancela el aviso de UNA gestión. */
  id: string;
  itemId: string;
  at: Date;
  title: string;
  body: string;
}

/** El identificador del aviso de una gestión. */
export const reminderId = (itemId: string): string => `agenda:${itemId}`;

/** `YYYY-MM-DD` + minutos desde la medianoche → ese instante en la hora local del teléfono. */
function wallClock(day: string, minutes: number): Date {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, Math.floor(minutes / 60), minutes % 60, 0, 0);
}

/** A qué hora (minutos del día) está agendada la gestión, y si es una hora exacta o el inicio de una franja. */
function startOf(item: AgendaListItem): { minutes: number; fixed: boolean } | null {
  const m = item.scheduledTime ? /^(\d{1,2}):(\d{2})/.exec(item.scheduledTime) : null;
  if (m) return { minutes: Number(m[1]) * 60 + Number(m[2]), fixed: true };
  const slot = item.timeSlot ? SLOT_START_MINUTES[item.timeSlot] : undefined;
  return slot === undefined ? null : { minutes: slot, fixed: false };
}

const hhmm = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Los avisos a programar, del más cercano al más lejano, sin pasados y con el tope. */
export function planReminders(items: AgendaListItem[], now: Date = new Date()): PlannedReminder[] {
  const seen = new Set<string>();
  const out: PlannedReminder[] = [];

  for (const item of items) {
    if (item.status !== AgendaItemStatus.SCHEDULED || seen.has(item.id)) continue;
    const start = startOf(item);
    if (!start) continue; // sin hora ni franja no hay a qué hora avisar
    seen.add(item.id);

    const day = item.scheduledDate.slice(0, 10);
    const at = wallClock(day, start.fixed ? start.minutes - REMINDER_LEAD_MINUTES : start.minutes);
    if (at.getTime() <= now.getTime()) continue;

    const what = TYPE_PHRASE[item.type] ?? 'Gestión';
    const who = item.clientName ? ` con ${item.clientName}` : '';
    out.push({
      id: reminderId(item.id),
      itemId: item.id,
      at,
      title: `${what}${who}`,
      body: start.fixed
        ? `En ${REMINDER_LEAD_MINUTES} min · ${hhmm(start.minutes)}`
        : `Tienes esta gestión ${SLOT_PHRASE[item.timeSlot ?? ''] ?? 'hoy'}`,
    });
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id)).slice(0, MAX_REMINDERS);
}
