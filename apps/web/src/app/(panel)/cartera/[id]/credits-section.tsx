import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import type { CreditDetail } from '@kobrax/shared';
import { Badge } from '@/components/panel-ui';
import { money, date, relativeDate } from '@/lib/format';

const STATUS_TONE: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
  ACTIVE: 'neutral',
  PAID: 'success',
  DEFAULTED: 'danger',
  WRITTEN_OFF: 'danger',
  RESTRUCTURED: 'warning',
  CANCELLED: 'neutral',
};

/**
 * Los que ya no se trabajan. Se guardan para el historial, pero no compiten por la atención con los
 * que hay que ir a cobrar.
 */
const CERRADOS = ['PAID', 'CANCELLED', 'WRITTEN_OFF'];

/**
 * Los créditos del cliente: **una tarjeta plegable por crédito**.
 *
 * 🔴 **El acordeón es `<details>` nativo, sin una línea de JavaScript.** Abrir y cerrar lo hace el
 * navegador, funciona con teclado solo, y esta sección sigue siendo un server component — o sea que
 * la lista no viaja al navegador. Un acordeón con `useState` habría convertido toda la ficha de
 * créditos en JavaScript por un chevron.
 *
 * Cerrado dice lo que se pregunta de lejos —cuál es, de cuánto, cómo va—; abierto, los tres números
 * con los que se negocia. **El código es un link al detalle**; el resto de la tarjeta pliega.
 *
 * ⚠️ **Acá no se dice si tiene cronograma.** El listado de créditos no incluye las cuotas, así que
 * `hasSchedule` viene `false` para todos — no porque no lo tengan, sino porque no se las pidieron.
 * Eso sólo lo sabe la ficha del crédito, que sí las trae.
 */
export async function CreditsSection({
  clientId,
  credits,
  types,
  showClosed,
  denied,
}: {
  clientId: string;
  credits: CreditDetail[];
  /** Código → rótulo del catálogo `CREDIT_TYPE` del tenant. */
  types: Map<string, string>;
  /** El «Ver historial» de la URL: con esto también salen los cerrados. */
  showClosed?: boolean;
  denied?: boolean;
}) {
  const t = await getTranslations('portfolio');
  const locale = await getLocale();

  if (denied) return <p className="text-[14px] text-k-muted">{t('creditsDenied')}</p>;

  const cerrados = credits.filter((c) => c.status && CERRADOS.includes(c.status)).length;
  const visibles = showClosed ? credits : credits.filter((c) => !c.status || !CERRADOS.includes(c.status));

  return (
    <>
      {/* El link vive acá y no en el encabezado de la sección: es de esta lista, no de la ficha. */}
      {cerrados > 0 && (
        <p className="mb-3 text-right">
          <Link
            href={showClosed ? `/cartera/${clientId}` : `/cartera/${clientId}?historial=1`}
            className="text-[13px] font-medium text-k-periwinkle hover:underline"
          >
            {showClosed ? t('hideHistory') : t('showHistory', { count: cerrados })}
          </Link>
        </p>
      )}

      {visibles.length === 0 ? (
        // 🔴 «No tiene créditos» y «no tiene ninguno abierto» no son lo mismo: con un crédito pagado
        // escondido detrás del historial, lo primero es directamente falso.
        <p className="text-[14px] text-k-muted">{cerrados > 0 ? t('noOpenCredits') : t('noCredits')}</p>
      ) : (
        <ul className="space-y-3">
          {visibles.map((c) => (
            <li key={c.id}>
              <CreditCard credit={c} clientId={clientId} types={types} locale={locale} t={t} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function CreditCard({
  credit: c,
  clientId,
  types,
  locale,
  t,
}: {
  credit: CreditDetail;
  clientId: string;
  types: Map<string, string>;
  locale: string;
  t: (k: string, v?: Record<string, string | number | Date>) => string;
}) {
  const cerrado = Boolean(c.status && CERRADOS.includes(c.status));

  return (
    <details className="group rounded-xl border border-k-border" open={!cerrado && (c.daysPastDue ?? 0) > 0}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-2 p-4 hover:bg-k-bg [&::-webkit-details-marker]:hidden">
        {/* El chevron gira con CSS al abrir: `group-open` es la clase que Tailwind da al `<details>`. */}
        <span aria-hidden className="text-k-muted transition-transform group-open:rotate-180">
          ⌄
        </span>

        <span className="min-w-0 flex-1">
          {/* 🔴 Sólo el código navega. La tarjeta entera como link haría que plegarla te saque de
              la pantalla; el chevron solo, que haya que apuntarle a 16 píxeles. */}
          <Link
            href={`/cartera/${clientId}/credito/${c.id}`}
            className="block truncate text-[15px] font-semibold text-k-text hover:underline"
          >
            {c.code ?? t('noCode')}
          </Link>
          <span className="block truncate text-[13px] text-k-text-2">
            {(c.typeCode && types.get(c.typeCode)) || t('creditNoType')}
          </span>
        </span>

        <span className="text-right">
          <span className="block text-[11px] uppercase tracking-wide text-k-muted">{t('credit.principal')}</span>
          <span className="block text-[15px] font-semibold tabular-nums text-k-text">
            {money(c.principalAmount, c.currency)}
          </span>
        </span>

        <span className="flex flex-col items-end gap-1">
          {c.status && (
            <Badge tone={STATUS_TONE[c.status] ?? 'neutral'} dot>
              {t(`creditStatus.${c.status}`)}
            </Badge>
          )}
          {/* Del cerrado interesa CUÁNDO; del vivo, cuánto lleva de atraso. */}
          {cerrado
            ? c.nextDueDate && <span className="text-[12px] text-k-muted">{relativeDate(c.nextDueDate, locale)}</span>
            : (c.daysPastDue ?? 0) > 0 && (
                <span className="text-[12px] font-medium text-k-danger">{t('days', { count: c.daysPastDue ?? 0 })}</span>
              )}
        </span>
      </summary>

      <div className="border-t border-k-border p-4">
        <dl className="grid gap-4 sm:grid-cols-3">
          <Figure label={t('credit.principal')} value={money(c.principalAmount, c.currency)} />
          <Figure
            label={t('credit.installment')}
            value={c.installmentAmount != null ? money(c.installmentAmount, c.currency) : '—'}
            hint={c.nextDueDate ? t('dueOn', { date: date(c.nextDueDate, locale) }) : undefined}
          />
          <Figure label={t('credit.outstanding')} value={money(c.outstandingBalance, c.currency)} />
        </dl>

        <Progress principal={c.principalAmount} outstanding={c.outstandingBalance} label={t('credit.progress')} />

        {c.locked && <p className="mt-3 text-[12px] text-k-muted">{t('importedHint')}</p>}
      </div>
    </details>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="text-[12px] text-k-text-2">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-k-text">{value}</dd>
      {hint && <p className="text-[12px] text-k-muted">{hint}</p>}
    </div>
  );
}

/**
 * Cuánto se pagó del capital.
 *
 * 🔴 **No se dibuja si el número no significa nada.** Sin capital no hay porcentaje que calcular, y
 * un crédito importado puede traer un saldo MAYOR que su capital —intereses y cargos que el archivo
 * ya sumó al saldo—: ahí el «progreso» daría negativo. Se recorta a 0–100 y, sin capital, no hay
 * barra: una barra vacía dice «no pagó nada», que es una acusación, no un dato faltante.
 */
function Progress({ principal, outstanding, label }: { principal: number; outstanding: number; label: string }) {
  if (!(principal > 0)) return null;
  const pct = Math.max(0, Math.min(100, Math.round(((principal - outstanding) / principal) * 100)));

  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[12px] text-k-text-2">{label}</span>
        <span className="text-[12px] font-medium tabular-nums text-k-text">{pct}%</span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-k-light-bg"
        role="progressbar"
        aria-label={label}
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="h-full rounded-full bg-k-periwinkle" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
