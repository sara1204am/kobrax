import { getTranslations } from 'next-intl/server';
import type { CollectorWork } from '@/lib/routes';
import { totalWork } from '@/lib/routes';

/**
 * Los cuatro números del período, en una línea.
 *
 * 🔴 **Deliberadamente chicos.** Son el encabezado de la tabla, no un tablero: la respuesta a «quién
 * hizo qué» está en las filas, y cuatro tarjetas grandes empujarían la tabla —que es a lo que se
 * viene— media pantalla hacia abajo. Por eso no reusa nada de `components/dashboard`: eso arrastra
 * la grilla arrastrable entera para pintar cuatro cifras.
 *
 * Y son cuatro, no seis: cada uno contesta algo que se pregunta de verdad. La distancia no está
 * porque el dato sólo existe si alguien previsualizó la ruta.
 */
export async function WorkSummary({ rows }: { rows: CollectorWork[] }) {
  const t = await getTranslations('panel.routes.work');
  const total = totalWork(rows);

  const stats: { key: string; value: number; strong?: boolean }[] = [
    { key: 'collectors', value: total.collectors },
    { key: 'stops', value: total.stops, strong: true },
    { key: 'done', value: total.done },
    { key: 'pending', value: total.pending },
  ];

  return (
    <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((s) => (
        <div key={s.key} className="rounded-xl border border-k-border bg-white px-4 py-3">
          <dd className={`text-[22px] font-semibold tabular-nums ${s.strong ? 'text-k-navy' : 'text-k-text'}`}>
            {s.value}
          </dd>
          <dt className="text-[12px] uppercase tracking-wide text-k-text-2">{t(`summary.${s.key}`)}</dt>
        </div>
      ))}
    </dl>
  );
}
