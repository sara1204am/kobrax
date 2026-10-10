import { getTranslations } from 'next-intl/server';
import type { KpiValue } from '@kobrax/shared';
import { deltaOf } from '@/lib/dashboard';

/**
 * Un número grande con su variación **sólo si existe**.
 *
 * 🔴 Cuando la API manda `previous: null` —los tres saldos, porque la base no guarda su historia—
 * acá **no se dibuja ninguna flecha**, y en su lugar se dice por qué. Inventar un «↑ 7,4 %» sobre
 * plata es peor que no mostrarlo: la pantalla lo presentaría como dato duro.
 *
 * El rótulo lo pone el marco (es el título del widget): acá va sólo el número.
 */
export async function KpiWidget({
  kpi,
  format,
  parts,
  label,
}: {
  kpi: KpiValue;
  /** El rótulo va DEBAJO del número, como en las tarjetas de la agenda. */
  label: string;
  format: (value: number) => string;
  /**
   * D7: lo que aporta cada fuente a este número, cuando el tablero mira más de una. Sumarlas sin
   * decirlo mezcla un saldo calculado con uno reportado al corte de otro día.
   */
  parts?: { label: string; value: string }[];
}) {
  const t = await getTranslations('panel.dashboard');
  const delta = deltaOf(kpi);

  return (
    <div className="text-center">
      <p className="text-[24px] font-semibold leading-tight text-k-navy">{format(kpi.value)}</p>
      <p className="mt-0.5 text-[12px] font-medium text-k-text-2">{label}</p>
      {delta ? (
        <p className={`mt-1 text-[12px] ${delta.up ? 'text-k-success' : 'text-k-danger'}`}>
          {delta.up ? '↑' : '↓'} {Math.abs(delta.pct)}% <span className="text-k-muted">{t('vsPrevious')}</span>
        </p>
      ) : (
        <p className="mt-1 text-[12px] text-k-muted">{t('noHistory')}</p>
      )}
      {parts && parts.length > 1 && (
        <p className="mt-1 text-[12px] text-k-text-2">
          {parts.map((p, i) => (
            <span key={p.label}>
              {i > 0 && ' · '}
              {p.label} <span className="tabular-nums">{p.value}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
