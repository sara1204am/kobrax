import type { ReactNode } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { memberName, type Member, type PaymentItem } from '@kobrax/shared';
import { Badge, Section } from '@/components/panel-ui';
import { date, money } from '@/lib/format';
import { ToneTile, TONES, type Tone } from '@/components/tone-tile';

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
      anchor="PAYMENTS"
      // El resumen queda fijo arriba y scrollea sólo la lista: ver `ul` más abajo.
      collapsible={{ count: payments?.length, scroll: false }}
      headerAction={
        payments && payments.length > 0 ? (
          <Link href={`/pagos?creditId=${creditId}`} className="hover:underline">
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
            <span className="font-semibold text-k-navy">{t('collected', { amount: money(collected, currency) })}</span>
          </p>
          {/* Alto fijo (unas 3 tarjetas) con scroll adentro. */}
          <ul className="max-h-[21rem] space-y-2.5 overflow-y-auto overscroll-contain pr-1">
            {payments.map((p) => {
              const look = METHOD_LOOK[p.method] ?? METHOD_LOOK.CASH!;
              const pill = TONES[look.tone].pill;
              return (
                <li key={p.id} className="flex gap-3.5 rounded-xl border border-k-border bg-white px-4 py-3 shadow-[0_2px_8px_rgba(26,58,82,.06)]">
                  <ToneTile tone={look.tone} size="lg" outline>
                    {look.icon}
                  </ToneTile>
                  <div className="min-w-0 flex-1">
                    <span className="text-[15px] font-semibold text-k-navy">{money(p.amount, currency)}</span>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-k-text-2">
                      <span>{tMethod(p.method)}</span>
                      {p.channel === 'EXTERNAL_CONFIRMED' && <Badge tone="neutral">{tChannel('EXTERNAL_CONFIRMED')}</Badge>}
                      {p.receiptNumber !== undefined && <span>{t('receipt', { n: p.receiptNumber })}</span>}
                      {p.registeredBy && <span>{t('by', { name: byId.get(p.registeredBy) ?? t('unknownUser') })}</span>}
                    </p>
                    {p.notes && <p className="mt-0.5 text-[13px] text-k-text">{p.notes}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className={`rounded-md px-2.5 py-1 text-[12px] font-medium ${pill}`}>{tMethod(p.method)}</span>
                    <span className="text-[12.5px] text-k-text-2">{date(p.paymentDate, locale)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {external && <p className="mt-3 text-[12px] text-k-muted">{t('externalNote')}</p>}
    </Section>
  );
}

/** El icono y el color de cada medio de pago: se reconoce de un vistazo cómo pagó. */
const METHOD_LOOK: Record<string, { tone: Tone; icon: ReactNode }> = {
  CASH: {
    tone: 'green',
    icon: (
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
        <circle cx="12" cy="12" r="2.6" />
        <path d="M6 9.5v.01M18 14.5v.01" />
      </>
    ),
  },
  MOBILE_PAYMENT: {
    tone: 'blue',
    icon: (
      <>
        <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
        <path d="M11 18.5h2" />
      </>
    ),
  },
  TRANSFER: {
    tone: 'purple',
    icon: <path d="M4 8h15m0 0-3.5-3.5M19 8l-3.5 3.5M20 16H5m0 0 3.5-3.5M5 16l3.5 3.5" />,
  },
  QR: {
    tone: 'amber',
    icon: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <path d="M14 14h2.5v2.5M20.5 14v.01M14 20.5h2.5M20.5 17.5V20.5h-2" />
      </>
    ),
  },
  CARD: {
    tone: 'teal',
    icon: (
      <>
        <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
        <path d="M2.5 10h19M6 15h3" />
      </>
    ),
  },
};
