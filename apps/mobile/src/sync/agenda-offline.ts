import { AgendaItemStatus, type AgendaListItem } from '@kobrax/shared';

/** Cuántos días hacia adelante se bajan en la hidratación de oficina: la semana que viene también se prepara sin señal. */
export const AGENDA_AHEAD_DAYS = 7;
/**
 * Techo de gestiones cuyo DETALLE se baja de a una. Cada detalle revela el teléfono y la dirección del deudor y el
 * servidor lo audita, así que no se baja «todo lo que haya»: lo que cabe en una jornada y su semana.
 */
export const MAX_AGENDA_DETAILS = 60;

/** `YYYY-MM-DD` + `n` días, en calendario (sin zona: son fechas-calendario). */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Qué gestiones se bajan completas para poder verlas y registrarlas sin señal: solo las pendientes (una ejecutada no se
 * vuelve a abrir para trabajarla), sin repetir, y en el orden en que importan — **hoy primero**, después lo vencido y
 * después lo que viene por fecha y hora. Si hay más que el techo, se quedan afuera las más lejanas, no las de hoy.
 */
export function agendaDetailIds(items: AgendaListItem[], today: string, max = MAX_AGENDA_DETAILS): string[] {
  const seen = new Set<string>();
  const pending = items.filter((i) => {
    if (i.status !== AgendaItemStatus.SCHEDULED || seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
  const rank = (i: AgendaListItem): number => {
    const day = i.scheduledDate.slice(0, 10);
    return day === today ? 0 : day < today ? 1 : 2;
  };
  pending.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.scheduledDate.localeCompare(b.scheduledDate) ||
      (a.scheduledTime ?? '99:99').localeCompare(b.scheduledTime ?? '99:99') ||
      a.id.localeCompare(b.id),
  );
  return pending.slice(0, max).map((i) => i.id);
}
