'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import { shiftDay } from '@/lib/agenda';

/**
 * El día que se está mirando.
 *
 * Viaja en la URL (`?date=`), igual que los filtros: la vista se comparte por link y el server
 * component pide ese día y no otro. El `<input type="date">` es nativo — trae calendario, teclado y
 * el formato del sistema, tres cosas que un picker propio haría peor.
 *
 * Los rótulos llegan por prop en vez de leerse de un namespace: lo usan la agenda y las rutas, y
 * cada una tiene el suyo.
 */
export function DayPicker({
  day,
  today,
  labels,
}: {
  day: string;
  today: string;
  labels: { previous: string; next: string; today: string; date: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const locale = useLocale();

  function go(next: string) {
    const query = new URLSearchParams(params.toString());
    query.set('date', next);
    /*
     * 🔴 Vuelve a la página 1. Nació en la agenda, que no pagina, y al reusarlo en rutas se
     * arrastraba el `page=2` al cambiar de día: la API devolvía vacío y la pantalla decía «no hay
     * rutas para este día» sobre un día que sí las tenía. Mentir sobre un día vacío es peor que
     * cualquier error visible.
     */
    query.set('page', '1');
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
      <button type="button" onClick={() => go(shiftDay(day, -1))} aria-label={labels.previous} className={ARROW}>
        ‹
      </button>
      <p className="min-w-[220px] text-[16px] font-semibold capitalize text-k-navy">{long}</p>
      <button type="button" onClick={() => go(shiftDay(day, 1))} aria-label={labels.next} className={ARROW}>
        ›
      </button>

      <label className="ml-2">
        <span className="sr-only">{labels.date}</span>
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
          {labels.today}
        </button>
      )}
    </div>
  );
}

const ARROW =
  'flex h-10 w-10 items-center justify-center rounded-xl border border-k-border bg-white text-[20px] leading-none text-k-text-2 hover:bg-k-bg';
