import { getTranslations } from 'next-intl/server';
import { nextPlan, planOf, usageLevel, type AccountInfo, type PlanLimit } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';

/**
 * Los topes que se listan, en el orden en que importan. Los asientos van aparte —arriba y con
 * barra— porque son **el único que el servidor hace cumplir**: el resto describe el plan.
 */
const LIMITS = ['credits', 'clients', 'photosPerMonth', 'actionsPerMonth', 'photoRetentionMonths'] as const;

const BAR = { ok: 'bg-k-periwinkle', near: 'bg-k-warning', full: 'bg-k-danger' } as const;

/**
 * Qué plan tiene la cuenta y qué incluye.
 *
 * Los números salen del catálogo de `shared`, no de la base: hoy la cuenta sólo guarda su
 * `planCode` y un `max_users` suelto. Por eso los asientos se dibujan con `maxUsers` —que es lo
 * que la API frena de verdad— y no con el número del plan; cuando difieren se dice, en vez de
 * mostrar dos cifras que se contradicen.
 */
export async function PlanCard({ account }: { account: AccountInfo }) {
  const t = await getTranslations('plans');
  const plan = planOf(account.planCode);
  const next = nextPlan(account.planCode);
  const level = usageLevel(account.memberCount, account.maxUsers);
  const pct = account.maxUsers > 0 ? Math.min(100, (account.memberCount / account.maxUsers) * 100) : 100;

  const limitText = (key: (typeof LIMITS)[number], value: PlanLimit) => {
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

      <div className="mt-5">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[13px] font-medium text-k-text">{t('seats')}</span>
          <span className="text-[13px] tabular-nums text-k-text-2">
            {t('seatsValue', { used: account.memberCount, max: account.maxUsers })}
          </span>
        </div>
        {/* Decoración: la cifra de arriba ya dice lo mismo, y un lector de pantalla no gana nada
            escuchando la barra dos veces. */}
        <div aria-hidden className="mt-1.5 h-2 overflow-hidden rounded-full bg-k-light-bg">
          <div className={`h-full rounded-full ${BAR[level]}`} style={{ width: `${pct}%` }} />
        </div>
        {plan?.limits.users != null && plan.limits.users !== account.maxUsers && (
          // El caso negociado (LIMITES §8.2): la cuenta tiene un número propio, distinto al del
          // plan. Sin esta línea, «Free» arriba y «3 de 5» abajo se leen como un error.
          <p className="mt-2 text-[13px] text-k-text-2">
            {t('seatsCustom', { max: account.maxUsers, plan: plan.limits.users })}
          </p>
        )}
      </div>

      {plan && (
        <>
          <h3 className="mt-6 border-t border-k-border pt-5 text-[11px] font-semibold uppercase tracking-wide text-k-text-2">
            {t('includes')}
          </h3>
          <dl className="mt-3 grid gap-x-8 gap-y-2.5 sm:grid-cols-2">
            {LIMITS.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-3">
                <dt className="text-[13px] text-k-text-2">{t(`limits.${key}`)}</dt>
                <dd className="text-[14px] font-medium tabular-nums text-k-text">
                  {limitText(key, plan.limits[key])}
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
