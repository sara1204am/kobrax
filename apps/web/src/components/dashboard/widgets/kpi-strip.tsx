import { getTranslations } from 'next-intl/server';
import type { AnalyticsSummary, KpiValue, TrendPoint } from '@kobrax/shared';
import { deltaOf } from '@/lib/dashboard';
import { percent } from '@/lib/format';

/** Los colores de la marca para cada serie (los mismos de `dashboard-colors`: no se inventan tonos). */
const TONE = { blue: '#5B7DBE', red: '#DC3545', green: '#27AE60' } as const;

/** Sin decimales: en una tira de lectura rápida «Bs 88.536» se lee mejor que «Bs 88.536,15». */
function bs(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('es-BO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
}

/** Un área suave con su línea, al pie de la tarjeta. Decorativa: el número ya dice todo. */
function Spark({ values, color, id }: { values: number[]; color: string; id: string }) {
  // Con menos de 3 puntos, o una línea plana, la curva sólo se ve como una raya: mejor sin ella.
  if (values.length < 3 || Math.max(...values) === Math.min(...values)) return null;
  const w = 120;
  const h = 40;
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" className="hidden h-10 w-[40%] shrink-0 self-end lg:block">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w} ${h} L0 ${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/**
 * La tira de indicadores: saldo, cartera en mora (monto y % juntos), créditos en mora y recaudo.
 *
 * 🔴 **La curva sólo se dibuja si hay serie real.** Saldo y recaudo salen de la tendencia del período;
 * la mora y los créditos en mora no guardan historia, así que van sin curva — dibujar una inventada
 * sería presentar como dato lo que no lo es (misma regla que `KpiWidget` con `previous: null`).
 * El desglose por fuente (D7) queda en el `title` de cada tarjeta y en el aviso de arriba.
 */
export async function KpiStrip({
  summary,
  trend,
  currency,
}: {
  summary: AnalyticsSummary;
  trend?: TrendPoint[];
  currency: string;
}) {
  const t = await getTranslations('panel.dashboard');
  const by = (key: 'outstanding' | 'overdue' | 'collected') =>
    summary.bySource.length > 1
      ? summary.bySource.map((s) => `${t(`sources.${s.source}`)} ${bs(s[key], currency)}`).join(' · ')
      : undefined;

  const cards: {
    key: string;
    label: string;
    kpi: KpiValue;
    value: string;
    /** Subir es malo (mora): el color de la flecha se invierte. */
    badUp: boolean;
    note?: string;
    series?: number[];
    tone: keyof typeof TONE;
    hint?: string;
  }[] = [
    { key: 'outstanding', label: t('kpi.outstanding'), kpi: summary.outstanding, value: bs(summary.outstanding.value, currency), badUp: false, tone: 'blue', hint: by('outstanding') },
    { key: 'overdue', label: t('kpi.overdue'), kpi: summary.overdue, value: bs(summary.overdue.value, currency), badUp: true, note: t('ofPortfolio', { pct: percent(summary.overdueRate.value) }), tone: 'red', hint: by('overdue') },
    { key: 'creditsInArrears', label: t('kpi.creditsInArrears'), kpi: summary.creditsInArrears, value: summary.creditsInArrears.value.toLocaleString('es-BO'), badUp: true, tone: 'red' },
    { key: 'collected', label: t('kpi.collected'), kpi: summary.collected, value: bs(summary.collected.value, currency), badUp: false, series: trend?.map((p) => p.collected), tone: 'green', hint: by('collected') },
  ];

  return (
    // Siempre 4 columnas: si la tira se parte en dos filas, la celda (2 filas de alto) las corta.
    <div className="grid h-full grid-cols-4 gap-3 xl:gap-4">
      {cards.map((c) => {
        const d = deltaOf(c.kpi);
        const good = d ? d.up !== c.badUp : true;
        return (
          <div key={c.key} title={c.hint} className="flex min-w-0 flex-col justify-center gap-1 rounded-2xl border border-k-border bg-white px-3 py-3 shadow-k-card xl:px-5 xl:py-4">
            <p className="truncate text-[13px] text-k-text-2">{c.label}</p>
            <div className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[20px] font-semibold leading-tight xl:text-[26px] text-k-navy">{c.value}</p>
                {c.note && <p className="truncate text-[12px] text-k-text-2">{c.note}</p>}
                {d ? (
                  <p className={`mt-0.5 text-[12px] font-medium tabular-nums ${d.pct === 0 ? 'text-k-muted' : good ? 'text-k-success' : 'text-k-danger'}`}>
                    {d.pct === 0 ? '—' : d.up ? '↑' : '↓'} {Math.abs(d.pct).toLocaleString('es-BO')}%
                  </p>
                ) : (
                  <p className="mt-0.5 text-[12px] text-k-muted" title={t('noHistory')}>{t('noCompare')}</p>
                )}
              </div>
              {c.series && <Spark values={c.series} color={TONE[c.tone]} id={`spark-${c.key}`} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}
