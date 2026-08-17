import { getTranslations } from 'next-intl/server';
import type { ClientDetail, CreditDetail } from '@kobrax/shared';
import { money } from '@/lib/format';

/**
 * El resumen de cuenta: lo que se debe, en grande.
 *
 * 🔴 **El balance y el conteo salen de las columnas del cliente, no de sumar los créditos acá.**
 * Son las mismas que ordena la lista de cartera —las mantiene un trigger sobre `credits`—, así que
 * la ficha y la lista **no pueden decir números distintos**. Sumando en la pantalla, alguien con más
 * créditos que el `limit` de la consulta vería menos deuda de la que tiene, y dos pantallas a un
 * clic de distancia se contradirían sobre plata.
 *
 * Los vencidos sí se cuentan de la lista traída: es un conteo de cuántos arrastran mora, y para eso
 * no hay columna.
 *
 * Va en tarjeta oscura porque es el único número que se lee de lejos: quien abre esta ficha viene a
 * saber cuánto debe antes que ninguna otra cosa.
 */
export async function AccountSummary({
  client,
  credits,
  currency,
}: {
  client: ClientDetail;
  credits: CreditDetail[];
  currency: string;
}) {
  const t = await getTranslations('portfolio');
  /*
   * 🔴 **Vencido es deber Y arrastrar días, las dos cosas.** Un crédito pagado puede conservar su
   * última mora en el dato —nadie la vuelve a cero al cobrar—, y contarlo diría «1 vencido» en una
   * ficha que arriba muestra Bs 0,00. Es el mismo criterio con el que la cartera pinta «Pagado» por
   * encima de «En mora».
   */
  const vencidos = credits.filter((c) => (c.daysPastDue ?? 0) > 0 && c.outstandingBalance > 0).length;

  return (
    <section aria-label={t('sections.summary')}>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{t('sections.summary')}</h2>
      <div className="rounded-2xl bg-k-navy p-5 text-white">
        <p className="text-[13px] text-white/70">{t('summary.balance')}</p>
        <p className="mt-1 text-[32px] font-semibold leading-tight tabular-nums">
          {money(client.totalDebt ?? 0, currency)}
        </p>

        <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/15 pt-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-white/60">{t('summary.credits')}</p>
            <p className="mt-0.5 text-[20px] font-semibold tabular-nums">{client.creditCount ?? 0}</p>
          </div>
          <div>
            <p className="text-[11px] uppercase tracking-wide text-white/60">{t('summary.overdue')}</p>
            {/* En verde cuando es cero: es la única cifra de la ficha donde cero es una buena
                noticia, y decirlo con color ahorra leer el número. */}
            <p className={`mt-0.5 text-[20px] font-semibold tabular-nums ${vencidos === 0 ? 'text-k-success' : 'text-k-danger'}`}>
              {vencidos}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
