import { useLocale, useTranslations } from 'next-intl';
import type { CreditScheduleRow } from '@kobrax/shared';
import { dayDate, money } from '@/lib/format';

/**
 * El plan de pagos: una fila por cuota con fecha, capital, interés, total y saldo de capital.
 *
 * 🔴 **Las filas no se calculan acá**: vienen de `calculateCredit` (shared), el mismo motor con el
 * que la API guarda el crédito. Esta tabla sólo dibuja.
 *
 * Nace para la vista previa del alta (F4/06 · Fase 2) y es la que el detalle va a usar en la Fase 3,
 * reemplazando al `Schedule` de la ficha.
 *
 * Las fechas son días civiles (`YYYY-MM-DD`): van con `dayDate`, en UTC. Con `date()` Bolivia las
 * pintaría un día antes.
 */
export function PaymentPlanTable({ rows, currency }: { rows: CreditScheduleRow[]; currency: string }) {
  const t = useTranslations('portfolio.creditForm.plan');
  const locale = useLocale();

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-k-border text-left text-[12px] font-semibold uppercase tracking-wide text-k-text-2">
            <th scope="col" className="py-2 pr-4">{t('number')}</th>
            <th scope="col" className="py-2 pr-4">{t('dueDate')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('principal')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('interest')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('amount')}</th>
            <th scope="col" className="py-2 text-right">{t('balance')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.number} className="border-b border-k-border last:border-0">
              <td className="py-2 pr-4 text-k-text-2">{r.number}</td>
              <td className="py-2 pr-4 whitespace-nowrap">{dayDate(r.dueDate, locale)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(r.principal, currency)}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{money(r.interest, currency)}</td>
              <td className="py-2 pr-4 text-right font-semibold tabular-nums text-k-text">{money(r.amount, currency)}</td>
              <td className="py-2 text-right tabular-nums text-k-text-2">{money(r.principalBalance, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
