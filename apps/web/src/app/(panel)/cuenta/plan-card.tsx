import { getTranslations } from 'next-intl/server';
import { nextPlan, planOf, usageLevel, type AccountInfo, type PlanLimit } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';

/**
 * Los topes **que se cuentan**, con barra. Cada fase que agrega un contador agrega su clave acá y
 * su número aparece solo: el servidor ya lo manda en `usage`.
 */
const CONTADOS = ['users', 'credits', 'clients'] as const;

/**
 * Los que todavía no se cuentan: se listan como texto, sin barra.
 *
 * 🔴 Dibujarles una barra vacía diría «llevás cero fotos este mes», que es mentira — nadie las
 * está contando. Un tope sin contador se describe, no se mide.
 */
const DESCRITOS = ['photosPerMonth', 'actionsPerMonth', 'photoRetentionMonths'] as const;

const BAR = { ok: 'bg-k-periwinkle', near: 'bg-k-warning', full: 'bg-k-danger' } as const;

/**
 * Qué plan tiene la cuenta, cuánto lleva usado y qué incluye.
 *
 * Los topes se pintan con `account.limits`, que es lo que **rige de verdad** para esta cuenta: el
 * plan con su excepción negociada ya aplicada. El catálogo sólo aporta el nombre, el precio y —para
 * la línea de «ajuste a medida»— con qué comparar.
 */
export async function PlanCard({ account }: { account: AccountInfo }) {
  const t = await getTranslations('plans');
  const plan = planOf(account.planCode);
  const next = nextPlan(account.planCode);
  const asientos = account.limits.users;

  const limitText = (key: (typeof DESCRITOS)[number], value: PlanLimit) => {
    if (value === null) return t('unlimited');
    return key === 'photoRetentionMonths' ? t('months', { n: value }) : t('count', { n: value });
  };

  return (
    <Section title={t('title')} inner="p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[20px] font-semibold text-k-navy">
          {plan ? t(`names.${plan.code}`) : t('unknown', { code: account.planCode })}
        </p>
        {plan && (
          <p className="text-[14px] text-k-text-2">
            {t(`price.${plan.code}`, { base: plan.price.base, perSeat: plan.price.perSeat })}
          </p>
        )}
      </div>

      <div className="mt-5 space-y-4">
        {CONTADOS.map((key) => (
          <Medidor
            key={key}
            label={key === 'users' ? t('seats') : t(`limits.${key}`)}
            used={account.usage[key]}
            max={account.limits[key]}
            texto={
              account.limits[key] === null
                ? t('count', { n: account.usage[key] })
                : t('seatsValue', { used: account.usage[key], max: account.limits[key] as number })
            }
          />
        ))}
      </div>

      {plan?.limits.users != null && asientos !== null && plan.limits.users !== asientos && (
        // El caso negociado (LIMITES §8.2): esta cuenta tiene un número propio, distinto al de su
        // plan. Sin esta línea, «Free» arriba y «3 de 5» abajo se leen como un error.
        <p className="mt-2 text-[13px] text-k-text-2">
          {t('seatsCustom', { max: asientos, plan: plan.limits.users })}
        </p>
      )}

      {plan && (
        <>
          <h3 className="mt-6 border-t border-k-border pt-5 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
            {t('includes')}
          </h3>
          <dl className="mt-3 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {DESCRITOS.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-k-text-2">{t(`limits.${key}`)}</dt>
                <dd className="text-[14px] font-medium tabular-nums text-k-text">
                  {/* De la cuenta y no del catálogo: si negoció otro número, es ése el que rige. */}
                  {limitText(key, account.limits[key])}
                </dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-[13px] text-k-text-2">{t('limits.support')}</dt>
              <dd className="text-right text-[14px] font-medium text-k-text">
                {t(`support.${plan.code}`)}
              </dd>
            </div>
          </dl>
        </>
      )}

      {next && (
        <p className="mt-6 rounded-xl bg-k-highlight px-4 py-3 text-[13px] leading-relaxed text-k-text-2">
          {next.limits.users != null && next.limits.credits != null
            ? t('upgrade', {
                plan: t(`names.${next.code}`),
                users: next.limits.users,
                credits: next.limits.credits,
              })
            : t('upgradeTop', { plan: t(`names.${next.code}`) })}{' '}
          {t('upgradeHow')}
        </p>
      )}
    </Section>
  );
}

/** Un tope con su consumo. Sin tope no hay barra: una barra contra el infinito no dice nada. */
function Medidor({
  label,
  used,
  max,
  texto,
}: {
  label: string;
  used: number;
  max: PlanLimit;
  texto: string;
}) {
  const level = usageLevel(used, max);
  const pct = max === null ? 0 : max > 0 ? Math.min(100, (used / max) * 100) : 100;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-k-text">{label}</span>
        <span className="text-[13px] tabular-nums text-k-text-2">{texto}</span>
      </div>
      {/* Decoración: la cifra de arriba ya lo dijo, y un lector de pantalla no gana nada
          escuchándolo dos veces. */}
      {max !== null && (
        <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-full bg-k-light-bg">
          <div className={`h-full rounded-full ${BAR[level]}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
