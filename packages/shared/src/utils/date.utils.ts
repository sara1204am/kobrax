/** Formatea una fecha para Latinoamérica (dd/mm/aaaa por defecto). */
export function formatDate(date: Date | string, locale = 'es-BO'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

/** Días de mora entre la fecha de vencimiento y hoy (0 si aún no vence). */
export function daysPastDue(dueDate: Date | string, now: Date = new Date()): number {
  const due = typeof dueDate === 'string' ? new Date(dueDate) : dueDate;
  const ms = now.getTime() - due.getTime();
  return ms <= 0 ? 0 : Math.floor(ms / 86_400_000);
}
