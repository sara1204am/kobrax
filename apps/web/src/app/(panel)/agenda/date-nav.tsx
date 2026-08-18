'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { monthGrid, shiftDay, shiftMonth, weekOf, type DayLoad } from '@/lib/agenda';

/** El nombre corto del día y el número, en el idioma de quien mira. */
function partes(iso: string, locale: string): { dow: string; num: string } {
  const d = new Date(`${iso}T00:00:00.000Z`);
  return {
    dow: new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(d),
    num: String(d.getUTCDate()),
  };
}

function mesLargo(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00.000Z`),
  );
}

export function fechaLarga(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00.000Z`),
  );
}

/**
 * Navegar entre días, en tres niveles según el largo del salto.
 *
 * 🔴 **Reemplaza al `<input type="date">` nativo**, que era el único camino para cambiar de día y
 * tenía dos problemas: se ve distinto en cada navegador —y en algunos ni se abre con teclado—, y
 * sobre todo **no dice nada**. Un calendario del sistema no sabe que el martes hay cuarenta
 * gestiones y el miércoles ninguna, así que elegir día era a ciegas.
 *
 * · Las flechas, para ±1 día — el salto de todos los días.
 * · La tira semanal, para moverse dentro de la semana **viendo la carga de cada día**.
 * · La fecha, que abre un mini calendario, para el salto largo.
 */
export function DateNav({
  day,
  today,
  load,
  onPick,
}: {
  day: string;
  today: string;
  /** Cuántas gestiones cae en cada día de la semana visible. Lo trae el servidor con el rango. */
  load: Map<string, DayLoad>;
  onPick: (iso: string) => void;
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  /*
   * Cerrar al tocar afuera y con Esc. Un popover que sólo cierra con su propio botón deja a quien
   * lo abrió por error con la pantalla tapada — y Esc es lo primero que se intenta.
   */
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', esc);
    };
  }, [abierto]);

  const esHoy = day === today;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Flecha label={t('previousDay')} onClick={() => onPick(shiftDay(day, -1))} dir="prev" />

      <div ref={caja} className="relative">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-haspopup="dialog"
          className="flex h-9 items-center gap-2 rounded-lg border border-k-border bg-white px-3 text-[14px] font-medium text-k-text hover:bg-k-bg"
        >
          <span className="first-letter:uppercase">{fechaLarga(day, locale)}</span>
          <span aria-hidden className="text-k-muted">⌄</span>
        </button>
        {abierto && <MiniCalendario day={day} today={today} onPick={(iso) => { onPick(iso); setAbierto(false); }} />}
      </div>

      <Flecha label={t('nextDay')} onClick={() => onPick(shiftDay(day, 1))} dir="next" />

      {/* Siempre visible; apagado si ya se está en hoy — para que su lugar no baile en la barra. */}
      <button
        type="button"
        onClick={() => onPick(today)}
        disabled={esHoy}
        className="h-9 rounded-lg border border-k-border bg-white px-3 text-[13px] font-medium text-k-text-2 hover:bg-k-bg disabled:opacity-40 disabled:hover:bg-white"
      >
        {t('today')}
      </button>

      <WeekStrip day={day} today={today} load={load} onPick={onPick} />
    </div>
  );
}

function Flecha({ label, onClick, dir }: { label: string; onClick: () => void; dir: 'prev' | 'next' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-k-border bg-white text-k-text-2 hover:bg-k-bg"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={dir === 'prev' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
      </svg>
    </button>
  );
}

/**
 * La semana a la vista, **con la carga de cada día**.
 *
 * 🔴 Es lo que convierte elegir día en una decisión y no en una adivinanza: se ve dónde está el
 * trabajo antes de entrar. Los días pasados muestran lo que quedó vencido —en rojo— o un ✓ si se
 * cerró completo; los futuros, cuántas hay.
 */
function WeekStrip({
  day,
  today,
  load,
  onPick,
}: {
  day: string;
  today: string;
  load: Map<string, DayLoad>;
  onPick: (iso: string) => void;
}) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();

  return (
    <div className="flex w-full gap-1 overflow-x-auto sm:w-auto" role="group" aria-label={t('week')}>
      {weekOf(day).map((iso) => {
        const { dow, num } = partes(iso, locale);
        const d = load.get(iso);
        const activo = iso === day;
        const pasado = iso < today;
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onPick(iso)}
            aria-current={activo ? 'date' : undefined}
            aria-label={fechaLarga(iso, locale)}
            className={`flex min-w-[52px] flex-1 flex-col items-center gap-0.5 rounded-lg border px-2 py-1.5 transition-colors ${
              activo ? 'border-k-periwinkle bg-k-highlight' : 'border-k-border bg-white hover:bg-k-bg'
            }`}
          >
            <span className="text-[11px] capitalize text-k-muted">{dow}</span>
            <span className={`text-[15px] tabular-nums ${iso === today ? 'font-semibold text-k-periwinkle' : 'text-k-text'}`}>
              {num}
            </span>
            {/* Una línea sola, y sólo si dice algo: un «0» en cada día vacío es ruido. */}
            <span className="h-3 text-[10px] leading-3 tabular-nums">
              {!d ? (
                <span className="text-transparent">·</span>
              ) : d.overdue > 0 ? (
                <span className="font-semibold text-k-danger">{t('overdueShort', { n: d.overdue })}</span>
              ) : pasado && d.done === d.total ? (
                <span className="text-k-success">✓</span>
              ) : (
                <span className="text-k-text-2">{d.total}</span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** El salto largo. Un mes por vez, con el día de hoy y el elegido marcados. */
function MiniCalendario({ day, today, onPick }: { day: string; today: string; onPick: (iso: string) => void }) {
  const t = useTranslations('panel.agenda');
  const locale = useLocale();
  const [mes, setMes] = useState(day);
  const grid = monthGrid(mes);
  const delMes = (iso: string) => iso.slice(0, 7) === mes.slice(0, 7);

  return (
    <div
      role="dialog"
      aria-label={t('pickDate')}
      className="absolute left-0 top-11 z-20 w-[280px] rounded-xl border border-k-border bg-white p-3 shadow-k-card"
    >
      <div className="mb-2 flex items-center justify-between">
        <Flecha label={t('previousMonth')} onClick={() => setMes(shiftMonth(mes, -1))} dir="prev" />
        <span className="text-[13px] font-medium capitalize text-k-text">{mesLargo(mes, locale)}</span>
        <Flecha label={t('nextMonth')} onClick={() => setMes(shiftMonth(mes, 1))} dir="next" />
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {grid.slice(0, 7).map((iso) => (
          <span key={`h${iso}`} className="pb-1 text-center text-[10px] capitalize text-k-muted">
            {partes(iso, locale).dow.slice(0, 2)}
          </span>
        ))}
        {grid.map((iso) => (
          <button
            key={iso}
            type="button"
            onClick={() => onPick(iso)}
            aria-current={iso === day ? 'date' : undefined}
            className={`h-8 rounded-md text-[13px] tabular-nums transition-colors ${
              iso === day
                ? 'bg-k-navy font-semibold text-white'
                : iso === today
                  ? 'font-semibold text-k-periwinkle hover:bg-k-bg'
                  : delMes(iso)
                    ? 'text-k-text hover:bg-k-bg'
                    : 'text-k-muted hover:bg-k-bg'
            }`}
          >
            {partes(iso, locale).num}
          </button>
        ))}
      </div>
    </div>
  );
}
