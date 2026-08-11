import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { CreditDetail } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { money, date } from '@/lib/format';

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'neutral',
  PAID: 'success',
  DEFAULTED: 'danger',
  WRITTEN_OFF: 'danger',
  RESTRUCTURED: 'warning',
};

/**
 * Los créditos del cliente, dentro de su ficha.
 *
 * ⚠️ **Acá no se dice si tiene cronograma.** El listado de créditos no incluye las cuotas, así que
 * `hasSchedule` viene `false` para todos — no porque no lo tengan, sino porque no se las pidieron.
 * Eso sólo lo sabe la ficha del crédito, que sí las trae.
 *
 * Server component: no tiene una sola interacción, así que no viaja al navegador.
 */
export async function CreditsSection({
  clientId,
  credits,
  denied,
}: {
  clientId: string;
  credits: CreditDetail[];
  denied?: boolean;
}) {
  const t = await getTranslations('portfolio');

  if (denied) return <p className="text-[14px] text-k-muted">{t('creditsDenied')}</p>;
  if (credits.length === 0) return <p className="text-[14px] text-k-muted">{t('noCredits')}</p>;

  return (
    <ul className="divide-y divide-k-border">
      {credits.map((c) => (
        <li key={c.id}>
          <Link
            href={`/cartera/${clientId}/credito/${c.id}`}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 hover:bg-k-bg"
          >
            <span className="min-w-0">
              <span className="block font-medium text-k-text">
                {money(c.outstandingBalance, c.currency)}
                <span className="ml-2 text-[13px] font-normal text-k-text-2">
                  {t('ofPrincipal', { amount: money(c.principalAmount, c.currency) })}
                </span>
              </span>
              <span className="block text-[13px] text-k-text-2">
                {c.code ?? t('noCode')}
                {c.installmentAmount != null && ` · ${t('installmentOf', { amount: money(c.installmentAmount, c.currency) })}`}
                {c.nextDueDate && ` · ${t('dueOn', { date: date(c.nextDueDate) })}`}
              </span>
            </span>
            <span className="flex items-center gap-2">
              {(c.daysPastDue ?? 0) > 0 && (
                <span className="text-[13px] font-medium text-k-danger">{t('days', { count: c.daysPastDue! })}</span>
              )}
              {c.locked && <Badge tone="warning">{t('imported')}</Badge>}
              {c.status && <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{t(`creditStatus.${c.status}`)}</Badge>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
