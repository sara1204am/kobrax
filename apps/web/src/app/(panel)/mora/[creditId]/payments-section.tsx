import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, type Member, type PaymentItem } from '@kobrax/shared';
import { Badge, Section } from '@/components/panel-ui';
import { date, money } from '@/lib/format';

/**
 * Los pagos del crédito, del último al primero.
 *
 * 🔴 **Un pago sobre una operación de PSF no cambia el saldo ni la mora que reportó el archivo** (D3): cuenta como
 * recuperado, pero esos números se actualizan con el próximo reporte. Se avisa en la propia sección, o quien mira
 * «pagó 500» y «el saldo sigue igual» concluye que el pago se perdió.
 *
 * `payments === null` es «no se pudo leer» (sin `payment:read`): la ficha sigue entera.
 */
export function PaymentsSection({
  creditId,
  payments,
  members,
  currency,
  external,
}: {
  creditId: string;
  payments: PaymentItem[] | null;
  members: Member[];
  currency: string;
  /** El crédito es de una fuente externa (PSF). */
  external: boolean;
}) {
  const t = useTranslations('panel.cases.ficha.payments');
  const tMethod = useTranslations('panel.payments.method');
  const tChannel = useTranslations('panel.payments.channel');
  const locale = useLocale();
  const byId = new Map(members.map((m) => [m.userId, memberName(m)]));

  /** Lo cobrado: el que entró por Kobrax. Un pago confirmado de otro canal de la entidad no es plata que Kobrax cobró. */
  const collected = (payments ?? []).filter((p) => (p.channel ?? 'KOBRAX_COLLECTED') === 'KOBRAX_COLLECTED').reduce((s, p) => s + p.amount, 0);

  return (
    <Section
      title={t('title')}
      action={
        payments && payments.length > 0 ? (
          <Link href={`/pagos?creditId=${creditId}`} className="text-[13px] font-medium text-k-periwinkle hover:underline">
            {t('seeAll')}
          </Link>
        ) : undefined
      }
    >
      {payments === null ? (
        <p className="text-[13px] text-k-muted">{t('unavailable')}</p>
      ) : payments.length === 0 ? (
        <p className="text-[13px] text-k-muted">{t('empty')}</p>
      ) : (
        <>
          <p className="mb-3 text-[13px] text-k-text-2">
            {t('count', { n: payments.length })}
            {' · '}
            <span className="font-medium text-k-text">{t('collected', { amount: money(collected, currency) })}</span>
          </p>
          <ul className="divide-y divide-k-border">
            {payments.map((p) => (
              <li key={p.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold text-k-text">{money(p.amount, currency)}</span>
                  <span className="text-[13px] text-k-text-2">{date(p.paymentDate, locale)}</span>
                </div>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-k-muted">
                  <span>{tMethod(p.method)}</span>
                  {p.channel === 'EXTERNAL_CONFIRMED' && <Badge tone="neutral">{tChannel('EXTERNAL_CONFIRMED')}</Badge>}
                  {p.receiptNumber !== undefined && <span>{t('receipt', { n: p.receiptNumber })}</span>}
                  {p.registeredBy && <span>{t('by', { name: byId.get(p.registeredBy) ?? t('unknownUser') })}</span>}
                </p>
                {p.notes && <p className="mt-0.5 text-[12px] text-k-text-2">{p.notes}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
      {external && <p className="mt-3 text-[12px] text-k-muted">{t('externalNote')}</p>}
    </Section>
  );
}
