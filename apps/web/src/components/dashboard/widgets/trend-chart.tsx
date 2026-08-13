import { getTranslations } from 'next-intl/server';
import type { TrendPoint } from '@kobrax/shared';
import { TREND_COLORS } from '@/lib/dashboard-colors';
import { money } from '@/lib/format';
import { LineChart } from '../charts';

/**
 * La evolución de la cartera y de lo recaudado.
 *
 * 🔴 **Dos gráficos apilados y NO uno con dos ejes.** El boceto los tenía juntos con una escala a
 * cada lado, y ahí está la trampa: con 13 millones de saldo y 300 mil de recaudación, mover una de
 * las dos escalas hace que las curvas se crucen donde uno quiera. Apilados comparten el eje del
 * tiempo —que es la comparación honesta— y cada uno lee su propia magnitud.
 *
 * ⚠️ El saldo de cada punto está **reconstruido hacia atrás** (el de hoy más lo cobrado después),
 * así que es la curva de lo que la cobranza bajó, no la historia del saldo: ignora desembolsos.
 * Se dice abajo, no se esconde.
 */
export async function TrendChart({ points, currency }: { points: TrendPoint[]; currency: string }) {
  const t = await getTranslations('panel.dashboard');
  if (points.length < 2) return <p className="text-[13px] text-k-text-2">{t('noTrend')}</p>;

  const short = (iso: string): string =>
    new Date(`${iso}T00:00:00.000Z`).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', timeZone: 'UTC' });

  return (
    <div className="space-y-4">
      <Series
        label={t('trend.outstanding')}
        color={TREND_COLORS.outstanding}
        points={points.map((p) => ({ x: short(p.date), y: p.outstanding, display: money(p.outstanding, currency) }))}
      />
      <Series
        label={t('trend.collected')}
        color={TREND_COLORS.collected}
        points={points.map((p) => ({ x: short(p.date), y: p.collected, display: money(p.collected, currency) }))}
      />
      <p className="text-[11px] text-k-muted">{t('trend.reconstructed')}</p>
    </div>
  );
}

function Series({
  label,
  color,
  points,
}: {
  label: string;
  color: string;
  points: { x: string; y: number; display: string }[];
}) {
  const last = points[points.length - 1];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[12px] text-k-text-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} aria-hidden />
          {label}
        </span>
        {/* Un solo valor rotulado —el último— en vez de uno por punto: es el que se busca al mirar
            una tendencia, y el resto se lee de la forma de la curva. */}
        <span className="text-[12px] font-medium tabular-nums text-k-text">{last?.display}</span>
      </div>
      <LineChart points={points} color={color} label={label} />
      <div className="mt-1 flex justify-between text-[10px] text-k-muted">
        <span>{points[0]?.x}</span>
        <span>{last?.x}</span>
      </div>
    </div>
  );
}
