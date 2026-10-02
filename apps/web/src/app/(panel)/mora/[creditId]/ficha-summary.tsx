import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

/** Cuánto del capital original ya no se debe, de 0 a 100. Sin los dos números no hay porcentaje: se dice, no se inventa. */
export function paidPercent(principal: number | undefined, balance: number | undefined): number | undefined {
  if (principal === undefined || balance === undefined || principal <= 0) return undefined;
  return Math.max(0, Math.min(100, Math.round(((principal - balance) / principal) * 100)));
}

/** Una celda de la cuadrícula: rótulo chico arriba, valor abajo. `danger` pinta el valor de rojo (la mora). */
function Cell({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-white px-4 py-3.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</dt>
      <dd className={`mt-1 text-[16px] font-semibold tabular-nums ${danger ? 'text-k-danger' : 'text-k-text'}`}>{value}</dd>
    </div>
  );
}

/**
 * La tarjeta de resumen de la ficha: **a la izquierda lo que se debe, en grande** (la tarjeta navy de Cartera,
 * con cuánto del capital ya se pagó) y **a la derecha el resto de los datos** en una cuadrícula con divisores.
 *
 * 🔴 **El saldo total y lo realmente vencido son dos números distintos** y se muestran por separado. Un dato que
 * el archivo no trajo es «—», nunca 0. Y el porcentaje pagado sólo existe si hay capital original y saldo.
 */
export function FichaSummary({
  chips,
  balance,
  principal,
  overdue,
  daysPastDue,
  installment,
  nextDueDate,
  lastPayment,
  moraSince,
  sla,
  assignee,
  branch,
  clientHref,
  creditHref,
  amount,
}: {
  /** Estado, prioridad y fuente: controles y etiquetas que arman el encabezado de la tarjeta. */
  chips: ReactNode;
  balance: number | undefined;
  principal: number | undefined;
  overdue: number | undefined;
  daysPastDue: number;
  installment: number | undefined;
  nextDueDate: string;
  lastPayment: string;
  moraSince: string;
  sla: string;
  assignee: string;
  branch: string | undefined;
  clientHref: string;
  creditHref: string;
  /** Formatea un monto ya con la moneda del crédito; `undefined` → «—». */
  amount: (n: number | undefined) => string;
}) {
  const t = useTranslations('panel.cases');
  const pct = paidPercent(principal, balance);

  return (
    <section aria-label={t('detail.summary')} className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">{chips}</div>

      <div className="rounded-2xl border border-k-border bg-white p-5">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="rounded-2xl bg-k-navy p-5 text-white">
            <p className="text-[13px] text-white/70">{t('detail.balanceOwed')}</p>
            <p className="mt-1 text-[32px] font-semibold leading-tight tabular-nums">{amount(balance)}</p>

            {pct !== undefined && (
              <div className="mt-4 flex items-center gap-3">
                <div
                  role="progressbar"
                  aria-label={t('detail.paidProgress')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct}
                  className="h-2 flex-1 overflow-hidden rounded-full bg-white/15"
                >
                  <div className="h-full rounded-full bg-k-periwinkle" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[13px] tabular-nums text-white/70">{pct} %</span>
              </div>
            )}

            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/15 pt-4">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/60">{t('detail.principal')}</p>
                <p className="mt-0.5 text-[18px] font-semibold tabular-nums">{amount(principal)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-white/60">{t('detail.overdue')}</p>
                <p className="mt-0.5 text-[18px] font-semibold tabular-nums text-k-danger">{amount(overdue)}</p>
              </div>
            </div>
          </div>

          {/* Divisores de un píxel con `gap-px` sobre fondo de borde: no hay que acordarse de qué celda lleva qué línea. */}
          <dl className="grid grid-cols-2 content-start gap-px overflow-hidden rounded-2xl border border-k-border bg-k-border sm:grid-cols-3">
            <Cell label={t('detail.currentArrears')} value={daysPastDue ? t('days', { n: daysPastDue }) : '—'} danger={daysPastDue > 0} />
            <Cell label={t('detail.installment')} value={amount(installment)} />
            <Cell label={t('detail.nextDueDate')} value={nextDueDate} />
            <Cell label={t('detail.lastPayment')} value={lastPayment} />
            <Cell label={t('detail.moraSince')} value={moraSince} />
            <Cell label={t('detail.sla')} value={sla} />
            <Cell label={t('detail.assignee')} value={assignee} />
            <Cell label={t('columns.branch')} value={branch ?? '—'} />
            {/* 8 celdas en 3 columnas dejan un hueco: se pinta blanco para que no asome el fondo del divisor. */}
            <div aria-hidden className="hidden bg-white sm:block" />
          </dl>
        </div>

        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-k-border pt-4">
          <Link href={clientHref} className="text-[14px] font-medium text-k-purple hover:underline">
            {t('detail.openClient')}
          </Link>
          <Link href={creditHref} className="text-[14px] font-medium text-k-purple hover:underline">
            {t('detail.openCredit')}
          </Link>
        </div>
      </div>
    </section>
  );
}
