import { date, time } from '@/lib/format';
import { daysAgo } from '@/lib/team';

/**
 * «Hoy, 14:30» · «Ayer, 18:20» · «12 oct 2026». Recibe el traductor de `team.lastAccess` (el mismo
 * shape en servidor y en cliente) para no atarse a ninguno de los dos.
 */
export function whenLabel(
  iso: string,
  locale: string,
  t: (key: 'today' | 'yesterday', values: { time: string }) => string,
): string {
  const days = daysAgo(iso);
  if (days === 0) return t('today', { time: time(iso, locale) });
  if (days === 1) return t('yesterday', { time: time(iso, locale) });
  return date(iso, locale);
}
