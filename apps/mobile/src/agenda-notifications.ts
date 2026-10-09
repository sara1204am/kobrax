/**
 * Los avisos locales de la agenda (F4/11 · E6, decisión D4): el teléfono le avisa al cobrador de lo que tiene agendado SIN
 * depender de que tenga la app abierta ni de que haya señal. Qué se avisa y cuándo lo decide `agenda-reminders.ts`; acá solo se
 * habla con el sistema.
 *
 * 🔴 **Son avisos locales, no push.** No sirven para decirle «te asignaron una gestión» si la app está cerrada: eso necesita un
 * servicio de push remoto, que no existe todavía (los canales del servidor son simulados). Lo que sí cubren es lo que el cobrador
 * ya tiene descargado: la gestión de las 15:30 avisa a las 15:15 aunque esté en la calle sin señal.
 *
 * Nada de acá puede romper la app: sin permiso, o si el sistema falla, simplemente no hay avisos.
 */
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { AgendaListItem } from '@kobrax/shared';
import * as db from './db';
import { planReminders, reminderId } from './agenda-reminders';

const CHANNEL = 'agenda';
const ASKED_KEY = 'agenda.notifications.asked';
const PREFIX = 'agenda:';

/** Una sola vez, al arrancar: cómo se muestra un aviso con la app abierta y el canal de Android. */
export async function configureAgendaNotifications(): Promise<void> {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Agenda',
      importance: Notifications.AndroidImportance.HIGH,
    }).catch(() => undefined);
  }
}

/**
 * ¿Se pueden mostrar avisos? Pide el permiso UNA vez por instalación: insistir cada vez que se abre la app, después de que la
 * persona dijo que no, es lo que hace que se desinstale. Si lo negó, no hay avisos y la app funciona igual.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain || (await db.getMeta(ASKED_KEY))) return false;
    await db.setMeta(ASKED_KEY, '1');
    const res = await Notifications.requestPermissionsAsync();
    return res.granted;
  } catch {
    return false;
  }
}

/**
 * Programa los avisos de las gestiones dadas. Un aviso por gestión, con el id `agenda:<id>`: programar el mismo id lo reemplaza,
 * así que repetirlo no duplica nada.
 *
 * `complete` = `items` es TODO lo agendado que el teléfono conoce (la hidratación): los avisos de gestiones que ya no están ahí
 * (se ejecutaron, se cancelaron, se reasignaron) se cancelan. Con `false` (una lista parcial, como la de hoy) solo se tocan las
 * gestiones de la lista.
 */
export async function syncAgendaReminders(items: AgendaListItem[], opts: { complete?: boolean; now?: Date } = {}): Promise<number> {
  try {
    if (!(await ensureNotificationPermission())) return 0;
    const planned = planReminders(items, opts.now);
    const keep = new Set(planned.map((p) => p.id));

    if (opts.complete) {
      const scheduled = await Notifications.getAllScheduledNotificationsAsync();
      for (const s of scheduled) {
        if (s.identifier.startsWith(PREFIX) && !keep.has(s.identifier)) await Notifications.cancelScheduledNotificationAsync(s.identifier);
      }
    } else {
      // Lo de la lista que ya no merece aviso (hecho, cancelado, sin hora o pasado) se cancela.
      for (const i of items) if (!keep.has(reminderId(i.id))) await Notifications.cancelScheduledNotificationAsync(reminderId(i.id));
    }

    for (const p of planned) {
      await Notifications.scheduleNotificationAsync({
        identifier: p.id,
        content: { title: p.title, body: p.body, data: { itemId: p.itemId } },
        trigger: { date: p.at, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
      });
    }
    return planned.length;
  } catch {
    return 0;
  }
}

/** Una gestión dejó de estar pendiente (o cambió de hora): su aviso ya no corresponde. */
export async function cancelAgendaReminder(itemId: string): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(reminderId(itemId));
  } catch {
    /* sin aviso que cancelar */
  }
}

/** Se cerró la sesión: los avisos son del cobrador que salió, no del que entre después en ese teléfono. */
export async function cancelAllAgendaReminders(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const s of scheduled) if (s.identifier.startsWith(PREFIX)) await Notifications.cancelScheduledNotificationAsync(s.identifier);
  } catch {
    /* ídem */
  }
}

/** A dónde lleva tocar un aviso: la gestión de la que habla. */
export function itemIdOfNotification(data: unknown): string | undefined {
  const id = (data as { itemId?: unknown } | null | undefined)?.itemId;
  return typeof id === 'string' && id ? id : undefined;
}
