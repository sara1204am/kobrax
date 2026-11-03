'use client';

import { useLocale, useTranslations } from 'next-intl';
import { isWithinWorkHours, isWorkingDate } from '@kobrax/shared';
import { useWorkPreferences } from '@/lib/use-work-preferences';

/**
 * Avisa —sin impedir— que lo que se está agendando cae fuera de lo que la cuenta configuró en Preferencias de trabajo:
 * un día en que el equipo no trabaja, o una hora fuera de la jornada. Es un aviso y no una regla: una visita un sábado
 * de feria o una cita a las 19:00 son legítimas, sólo que conviene que se hagan a propósito.
 *
 * `time` sólo va cuando se agenda con hora fija: una franja (mañana, tarde) no tiene una hora que comparar.
 */
export function ScheduleNotice({ date, time }: { date: string; time?: string }) {
  const t = useTranslations('panel.agenda.workNotice');
  const locale = useLocale();
  const prefs = useWorkPreferences();

  const notes: string[] = [];
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && !isWorkingDate(prefs, date)) {
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00.000Z`));
    notes.push(t('nonWorkDay', { weekday }));
  }
  if (time && /^\d{2}:\d{2}$/.test(time) && !isWithinWorkHours(prefs, time)) {
    notes.push(t('outsideHours', { time, start: prefs.workStart, end: prefs.workEnd }));
  }
  if (notes.length === 0) return null;

  return (
    <p role="status" className="rounded-xl border border-k-warning bg-k-warning-bg px-3 py-2 text-[12px] text-k-warning-text">
      {notes.join(' ')}
    </p>
  );
}
