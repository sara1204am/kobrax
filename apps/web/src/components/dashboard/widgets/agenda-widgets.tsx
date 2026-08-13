import { getTranslations } from 'next-intl/server';
import type { AgendaSummary } from '@kobrax/shared';
import { AGENDA_COLORS } from '@/lib/dashboard-colors';
import { deltaOf } from '@/lib/dashboard';
import { Donut, Legend, type Slice } from '../charts';

/** La agenda del período: en qué se repartió el trabajo. */
export async function AgendaDonut({ summary }: { summary: AgendaSummary }) {
  const t = await getTranslations('panel.dashboard');
  const ta = await getTranslations('panel.agenda');
  const total = summary.byType.reduce((s, r) => s + r.total, 0);

  if (total === 0) return <p className="text-[13px] text-k-text-2">{t('noAgenda')}</p>;

  const slices: Slice[] = summary.byType
    .slice()
    .sort((a, b) => b.total - a.total)
    .map((r) => ({
      key: r.type,
      label: ta.has(`type.${r.type}`) ? ta(`type.${r.type}`) : r.type,
      value: r.total,
      // El porcentaje va en la leyenda y no adentro de la dona: seis números encima de las
      // porciones se pisan entre sí en cuanto una es chica.
      display: `${r.total.toLocaleString('es-BO')} (${Math.round((r.total / total) * 100)}%)`,
      color: AGENDA_COLORS[r.type] ?? '#8FA3B8',
    }));

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Donut slices={slices} center={total.toLocaleString('es-BO')} caption={t('widgets.agenda')} />
      <Legend slices={slices} />
    </div>
  );
}

/**
 * Los indicadores de gestión: lo que se hizo, con su variación.
 *
 * Éstos **sí** comparan contra el período anterior, porque son flujos: se cuentan los agendados
 * ejecutados en cada ventana. No es lo mismo que un saldo, que es una foto y no tiene historia.
 */
export async function IndicatorsList({ summary }: { summary: AgendaSummary }) {
  const t = await getTranslations('panel.dashboard');

  return (
    <ul className="space-y-2.5">
      {summary.indicators.map((i) => {
        const delta = deltaOf({ value: i.value, previous: i.previous });
        return (
          <li key={i.code} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-k-text-2">{t(`indicators.${i.code}`)}</span>
            <span className="font-medium tabular-nums text-k-text">{i.value.toLocaleString('es-BO')}</span>
            <span className={`w-16 text-right text-[12px] tabular-nums ${delta ? (delta.up ? 'text-k-success' : 'text-k-danger') : 'text-k-muted'}`}>
              {delta ? `${delta.up ? '↑' : '↓'} ${Math.abs(delta.pct)}%` : '—'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
