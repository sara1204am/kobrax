import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { memberName, type CollectorPerformanceRow, type Member } from '@kobrax/shared';
import { money, percent } from '@/lib/format';

/**
 * El ranking de cobradores.
 *
 * Tabla plana y no el `DataTable` del panel: ése ordena y pagina navegando —recarga la pantalla
 * entera—, y acá se muestran ocho filas de un ranking que ya viene ordenado por el servidor. El
 * enlace de abajo lleva al listado de casos, que es donde sí se ordena y se filtra.
 *
 * ⚠️ **Sin `user:read` no hay nombres**: `/users` da 403 para SUPERVISOR. Se muestra un rótulo
 * genérico antes que un uuid crudo, y la fila sigue siendo útil porque los números son suyos.
 */
export async function CollectorsTable({
  rows,
  members,
  currency,
}: {
  rows: CollectorPerformanceRow[];
  members: Member[];
  currency: string;
}) {
  const t = await getTranslations('panel.dashboard');
  if (rows.length === 0) return <p className="text-[13px] text-k-text-2">{t('noCollectors')}</p>;

  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-k-border text-left text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
            <th scope="col" className="py-2 pr-3">{t('table.collector')}</th>
            <th scope="col" className="py-2 pr-3 text-right">{t('table.cases')}</th>
            <th scope="col" className="py-2 pr-3 text-right">{t('table.balance')}</th>
            <th scope="col" className="py-2 pr-3 text-right">{t('table.overdue')}</th>
            <th scope="col" className="py-2 pr-3 text-right">{t('table.overdueRate')}</th>
            <th scope="col" className="py-2 text-right">{t('table.collected')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r) => (
            <tr key={r.collectorId} className="border-b border-k-border last:border-0">
              <td className="py-2 pr-3 text-k-text">{byId.get(r.collectorId) ?? t('unknownCollector')}</td>
              <td className="py-2 pr-3 text-right tabular-nums text-k-text-2">{r.cases}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(r.outstanding, currency)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(r.overdue, currency)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {/* El % de mora lleva color porque es el número que ordena la conversación con el
                    cobrador; el resto de la fila es contexto. */}
                <span className={r.overdueRate >= 40 ? 'text-k-danger' : r.overdueRate >= 25 ? 'text-k-warning-text' : 'text-k-text-2'}>
                  {percent(r.overdueRate)}
                </span>
              </td>
              <td className="py-2 text-right font-medium tabular-nums text-k-text">{money(r.collected, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length > 8 && (
        <Link href="/casos" className="mt-3 inline-block text-[13px] font-medium text-k-purple hover:underline">
          {t('table.seeAll', { n: rows.length })}
        </Link>
      )}
    </div>
  );
}
