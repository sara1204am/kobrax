'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/panel-ui';

/**
 * El estado de un crédito en la importación (vista previa e historial). **La mora sale de los días de atraso**, igual que en el resto
 * del panel (F17: no es un estado guardado): un crédito vigente con atraso se lee «En mora», no «Vigente». Lo que escribió el banco
 * se conserva debajo. Un crédito pagado, castigado o anulado muestra su estado.
 */
export function SituationValue({ status, reported, daysPastDue }: { status?: string | null; reported?: string | null; daysPastDue?: number | null }) {
  const tp = useTranslations('portfolio');
  const ts = useTranslations('panel.mora.situation');
  const inArrears = (daysPastDue ?? 0) > 0 && (!status || status === 'ACTIVE');
  if (inArrears) {
    return (
      <span className="flex flex-col items-start gap-1">
        <Badge tone="danger" dot>
          {ts('IN_ARREARS')}
        </Badge>
        {reported && <span className="text-k-xs text-k-text-2">{reported}</span>}
      </span>
    );
  }
  const text = reported ?? (status ? tp(`creditStatus.${status}`) : '—');
  return <span className="text-k-sm text-k-text-2">{text}</span>;
}
