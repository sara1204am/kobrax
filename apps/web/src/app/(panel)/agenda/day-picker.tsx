'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { shiftDay } from '@/lib/agenda';

/**
 * El día que se está mirando.
 *
 * Viaja en la URL (`?date=`), igual que los filtros de casos: la vista se comparte por link y el
 * server component pide ese día y no otro. El `<input type="date">` es nativo — trae calendario,
 * teclado y el formato del sistema, tres cosas que un picker propio haría peor.
 */
export function DayPicker({ day, today }: { day: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const locale = useLocale();
  const t = useTranslations('panel.agenda');

  function go(next: string) {
    const query = new URLSearchParams(params.toString());
    query.set('date', next);
    router.push(`${pathname}?${query.toString()}`);
  }

  // El día se lee en UTC, que es como se guarda: en hora local, al oeste de Greenwich el título
  // mostraría el día anterior.
  const long = new Date(`${day}T00:00:00.000Z`).toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => go(shiftDay(day, -1))} aria-label={t('previousDay')} className={ARROW}>
        ‹
      </button>
      <p className="min-w-[220px] text-[16px] font-semibold capitalize text-k-navy">{long}</p>
      <button type="button" onClick={() => go(shiftDay(day, 1))} aria-label={t('nextDay')} className={ARROW}>
        ›
      </button>

      <label className="ml-2">
        <span className="sr-only">{t('date')}</span>
        <input
          type="date"
          value={day}
          onChange={(e) => e.target.value && go(e.target.value)}
          className="h-10 rounded-xl border border-k-border bg-white px-3 text-[14px] text-k-text outline-none focus:border-k-periwinkle focus:shadow-k-focus"
        />
      </label>

      {day !== today && (
        <button
          type="button"
          onClick={() => go(today)}
          className="min-h-[40px] text-[14px] font-medium text-k-purple hover:underline"
        >
          {t('today')}
        </button>
      )}
    </div>
  );
}

const ARROW =
  'flex h-10 w-10 items-center justify-center rounded-xl border border-k-border bg-white text-[20px] leading-none text-k-text-2 hover:bg-k-bg';
