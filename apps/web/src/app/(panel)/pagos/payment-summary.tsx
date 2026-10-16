import { getLocale, getTranslations } from 'next-intl/server';
import { DISPLAY_TIME_ZONE, date, money } from '@/lib/format';

/** Las cifras de arriba del ledger. Cada una ausente = la API no la mandó (versión vieja): se dibuja `—`, no un cero inventado. */
export interface PaymentTotals {
  /** Lo cobrado hoy (día civil de la empresa). Respeta fuente, medio y oficial; ignora el rango de fechas. */
  today?: number;
  /** Lo recuperado en el mes civil en curso. Mismos filtros que «hoy». */
  month?: number;
  /** Lo cobrado en el rango seleccionado, con todos los filtros. */
  period?: number;
  /** Cuántos pagos hay en el rango y los filtros (no los de la página). */
  count: number;
}

/**
 * Los colores de cada tarjeta, de más a menos protagonista: «hoy» en azul marino, «mes» en azul claro, «período» en
 * blanco con borde azul suave y la cuenta en gris azulado. Sólo color: tamaño, espaciado, bordes redondeados y
 * tipografía son los mismos para las cuatro (están en el JSX de abajo).
 *
 * Los textos secundarios son más oscuros que los grises de uso general (`k-muted`, 2,5:1 sobre blanco) para llegar a 4,5:1
 * sobre su fondo; es lo que hace legible la etiqueta de 12 px.
 */
const LOOK: Record<string, { box: string; value: string; label: string; hint: string }> = {
  today: { box: 'border-[#173F63] bg-[#173F63]', value: 'text-white', label: 'text-[#CFE3F7]', hint: 'text-[#A9CBEA]' },
  month: { box: 'border-k-border bg-[#EAF3FC]', value: 'text-[#173F63]', label: 'text-[#3F5F7F]', hint: 'text-[#4A6580]' },
  period: { box: 'border-[#C9DDF1] bg-white', value: 'text-[#173F63]', label: 'text-[#3F5F7F]', hint: 'text-[#5B7795]' },
  count: { box: 'border-k-border bg-[#F0F4F8]', value: 'text-[#173F63]', label: 'text-[#475D73]', hint: 'text-[#5A6F84]' },
};

/**
 * Cuatro tarjetas sobre el ledger. Primero el importe, después qué es, y debajo, en gris, de qué día o rango.
 *
 * 🔴 **Qué filtros mueve cada una** (y por qué «hoy» y «mes» no obedecen al rango):
 *  · **Cobrado hoy** y **Recuperado este mes** conservan su significado de día y mes civiles; por eso ignoran
 *    «Desde/Hasta». Sí respetan fuente, medio y oficial: «lo que cobró Ana hoy» es una pregunta válida.
 *  · **Total del período** y **Pagos registrados** responden a todo: rango, fuente, medio y oficial.
 * Las sumas son de TODO el conjunto, no de la página: las calcula la API con el mismo filtro que la lista.
 *
 * Un cobro pedido (QR/link) que nadie confirmó no es un pago: no está en el ledger y no suma acá.
 */
export async function PaymentSummary({
  totals,
  currency,
  period,
}: {
  totals: PaymentTotals;
  currency: string;
  /** Rango en pantalla, `YYYY-MM-DD`. */
  period: { from: string; to: string };
}) {
  const t = await getTranslations('panel.payments.summary');
  const locale = await getLocale();
  const now = new Date();
  const monthName = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: DISPLAY_TIME_ZONE }).format(now);
  const amount = (v?: number) => (v === undefined ? '—' : money(v, currency));

  const cards = [
    { key: 'today', value: amount(totals.today), label: t('today'), hint: date(now.toISOString(), locale), rule: t('ruleToday') },
    { key: 'month', value: amount(totals.month), label: t('month'), hint: monthName, rule: t('ruleMonth') },
    {
      key: 'period',
      value: amount(totals.period),
      label: t('period'),
      hint: t('range', { from: date(`${period.from}T12:00:00Z`, locale), to: date(`${period.to}T12:00:00Z`, locale) }),
      rule: t('rulePeriod'),
    },
    { key: 'count', value: String(totals.count), label: t('count'), hint: t('countHint'), rule: t('rulePeriod') },
  ];

  return (
    <dl aria-label={t('title')} className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((c) => (
        <div key={c.key} title={c.rule} className={`min-w-0 rounded-2xl border px-4 py-3 ${LOOK[c.key]!.box}`}>
          <dd className={`truncate text-[22px] font-semibold leading-tight tabular-nums ${LOOK[c.key]!.value}`}>{c.value}</dd>
          <dt className={`mt-0.5 text-[12px] font-medium ${LOOK[c.key]!.label}`}>{c.label}</dt>
          <p className={`mt-0.5 truncate text-[12px] ${LOOK[c.key]!.hint}`}>{c.hint}</p>
        </div>
      ))}
    </dl>
  );
}
