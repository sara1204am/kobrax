import { getTranslations } from 'next-intl/server';
import type { KpiValue } from '@kobrax/shared';
import { deltaOf } from '@/lib/dashboard';

/**
 * Un número del encabezado, con su variación **sólo si existe**.
 *
 * 🔴 Cuando la API manda `previous: null` —los tres saldos, porque la base no guarda su historia—
 * acá **no se dibuja ninguna flecha**, y en su lugar se dice por qué. Inventar un «↑ 7,4 %» sobre
 * plata es peor que no mostrarlo: la pantalla lo presentaría como dato duro.
 */
export async function KpiWidget({
  label,
  kpi,
  format,
}: {
  label: string;
  kpi: KpiValue;
  format: (value: number) => string;
}) {
  const t = await getTranslations('panel.dashboard');
  const delta = deltaOf(kpi);

  return (
    <section className="col-span-6 rounded-2xl border border-k-border bg-white p-4 lg:col-span-2">
      <p className="text-[12px] font-medium text-k-text-2">{label}</p>
      <p className="mt-1.5 text-[22px] font-semibold leading-tight text-k-navy">{format(kpi.value)}</p>
      {delta ? (
        <p className={`mt-1 text-[12px] ${delta.up ? 'text-k-success' : 'text-k-danger'}`}>
          {delta.up ? '↑' : '↓'} {Math.abs(delta.pct)}% <span className="text-k-muted">{t('vsPrevious')}</span>
        </p>
      ) : (
        <p className="mt-1 text-[12px] text-k-muted">{t('noHistory')}</p>
      )}
    </section>
  );
}
