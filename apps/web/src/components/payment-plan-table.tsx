import { useLocale, useTranslations } from 'next-intl';
import type { CreditScheduleRow } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { dayDate, money } from '@/lib/format';

/**
 * El plan de pagos: una fila por cuota con fecha, capital, interés, total y saldo de capital.
 *
 * 🔴 **Las filas no se calculan acá**: vienen de `calculateCredit` (shared), el mismo motor con el
 * que la API guarda el crédito. Esta tabla sólo dibuja.
 *
 * La usan la vista previa del alta (F4/06 · Fase 2) y la ficha del crédito, en lectura y edición (Fase 3).
 *
 * Las fechas son días civiles (`YYYY-MM-DD`): van con `dayDate`, en UTC. Con `date()` Bolivia las
 * pintaría un día antes.
 *
 * Con `paidCount` (D13) muestra el estado de cada cuota: las primeras `paidCount` pagadas antes de
 * registrarlo, el resto pendientes. Con `onPaidChange` cada fila se puede cambiar, pero **sólo mueve el
 * corte**: las pagadas son siempre las primeras, sin huecos (desmarcar la 4 deja 1–3; marcar la 7 deja
 * 1–7). La última no se marca: un crédito no se registra con todas pagas.
 */
export function PaymentPlanTable({
  rows,
  currency,
  paidCount,
  onPaidChange,
}: {
  rows: CreditScheduleRow[];
  currency: string;
  paidCount?: number;
  onPaidChange?: (paidCount: number) => void;
}) {
  const t = useTranslations('portfolio.creditForm.plan');
  const tp = useTranslations('portfolio.creditForm.paid');
  const locale = useLocale();
  // D18: las columnas de seguro y cargos sólo si el crédito los tiene.
  const extras = rows.some((r) => r.insurance !== undefined);
  const withStatus = paidCount !== undefined;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead>
          <tr className="border-b border-k-border text-left text-[12px] font-semibold uppercase tracking-wide text-k-text-2">
            <th scope="col" className="py-2 pr-4">{t('number')}</th>
            <th scope="col" className="py-2 pr-4">{t('dueDate')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('principal')}</th>
            <th scope="col" className="py-2 pr-4 text-right">{t('interest')}</th>
            {extras && <th scope="col" className="py-2 pr-4 text-right">{t('insurance')}</th>}
            {extras && <th scope="col" className="py-2 pr-4 text-right">{t('charges')}</th>}
            <th scope="col" className="py-2 pr-4 text-right">{t('amount')}</th>
            <th scope="col" className={`py-2 text-right ${withStatus ? 'pr-4' : ''}`}>{t('balance')}</th>
            {withStatus && <th scope="col" className="py-2">{tp('status')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const paid = withStatus && r.number <= paidCount;
            // Marcar la última dejaría todo pago: no se ofrece.
            const canToggle = onPaidChange && (paid || r.number < rows.length);
            return (
              <tr key={r.number} className={`border-b border-k-border last:border-0 ${paid ? 'bg-k-success-bg/40' : ''}`}>
                <td className="py-2 pr-4 text-k-text-2">{r.number}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{dayDate(r.dueDate, locale)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(r.principal, currency)}</td>
                <td className="py-2 pr-4 text-right tabular-nums">{money(r.interest, currency)}</td>
                {extras && <td className="py-2 pr-4 text-right tabular-nums">{money(r.insurance ?? 0, currency)}</td>}
                {extras && <td className="py-2 pr-4 text-right tabular-nums">{money(r.charges ?? 0, currency)}</td>}
                <td className="py-2 pr-4 text-right font-semibold tabular-nums text-k-text">{money(r.amount, currency)}</td>
                <td className={`py-2 text-right tabular-nums text-k-text-2 ${withStatus ? 'pr-4' : ''}`}>
                  {money(r.principalBalance, currency)}
                </td>
                {withStatus && (
                  <td className="py-2 whitespace-nowrap">
                    {canToggle ? (
                      <button
                        type="button"
                        onClick={() => onPaidChange!(paid ? r.number - 1 : r.number)}
                        title={paid ? tp('markPending') : tp('markPaid')}
                        aria-pressed={paid}
                        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-k-periwinkle"
                      >
                        <Badge tone={paid ? 'success' : 'neutral'}>{paid ? tp('paidStatus') : tp('pendingStatus')}</Badge>
                      </button>
                    ) : (
                      <Badge tone={paid ? 'success' : 'neutral'}>{paid ? tp('paidStatus') : tp('pendingStatus')}</Badge>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
