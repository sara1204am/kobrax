import { useLocale, useTranslations } from 'next-intl';
import type { UpdatedPlanRow } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';

/**
 * El plan de pagos ACTUALIZADO: las mismas cuotas del plan original (misma fecha, mismo importe) con lo pagado de cada una encima.
 *
 * No calcula nada: las filas vienen de la API (`CreditDetail.plan`, la misma función que usa Mora). Un pago de más no cambia el
 * importe de las cuotas que siguen: cubre la siguiente, y esa fila muestra «Parcial» con lo que falta.
 */
export function UpdatedPlanTable({ rows, currency }: { rows: UpdatedPlanRow[]; currency: string }) {
  const t = useTranslations('portfolio');
  const td = useTranslations('portfolio.creditDetail.updatedPlan');
  const tc = useTranslations('portfolio.creditForm.plan');
  const locale = useLocale();

  const tone = (s: UpdatedPlanRow['status']): 'success' | 'danger' | 'warning' | 'neutral' =>
    s === 'PAID' ? 'success' : s === 'OVERDUE' ? 'danger' : s === 'PARTIAL' ? 'warning' : 'neutral';

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-k-base" data-testid="updated-plan">
        <thead>
          <tr className="border-b border-k-border text-left text-k-xs font-semibold uppercase tracking-wide text-k-text-2">
            <th scope="col" className="py-2 pr-4">{tc('number')}</th>
            <th scope="col" className="py-2 pr-4">{tc('dueDate')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{tc('amount')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{td('paid')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{td('pending')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{td('daysPastDue')}</th>
            <th scope="col" className="py-2">{t('columns.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.number} className={`border-b border-k-border last:border-0 ${r.status === 'PAID' ? 'bg-k-success-bg/40' : ''}`}>
              <td className="py-2 pr-4 text-k-text-2">{r.number}</td>
              <td className="whitespace-nowrap py-2 pr-4">{dayDate(r.dueDate, locale)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(r.amount, currency)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {money(r.paid, currency)}
                {r.prepaid && (
                  <span className="ml-1 text-k-xs text-k-muted" title={td('beforeKobrax')}>
                    ·
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(r.pending, currency)}</td>
              {/* La mora es POR CUOTA: cada vencida lleva sus propios días. */}
              <td className="py-2 pr-4 text-right tabular-nums text-k-text-2">{r.daysPastDue > 0 ? r.daysPastDue : '—'}</td>
              <td className="py-2">
                <Badge tone={tone(r.status)}>{t(`installmentStatus.${r.status}`)}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
