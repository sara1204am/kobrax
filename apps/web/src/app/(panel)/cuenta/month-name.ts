/**
 * El nombre del mes que viene, **en el huso de la cuenta**: cerca de fin de mes el servidor puede
 * ir un día adelantado, y «se reinicia el 1 de septiembre» dicho en octubre es un contador que
 * miente. Mismo criterio (y mismo fallback ante una zona inválida) que `civilTodayUTC` en la API.
 */
export function nextMonthName(locale: string, timezone: string | null, now: Date = new Date()): string {
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1; // 1-based
  try {
    [y, m] = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone ?? 'UTC',
      year: 'numeric',
      month: '2-digit',
    })
      .format(now)
      .split('-')
      .map(Number) as [number, number];
  } catch {
    // zona inválida guardada a mano → mes UTC
  }
  // `m` ya es el índice 0-based del mes SIGUIENTE, porque Date.UTC cuenta desde 0.
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m, 1)),
  );
}
