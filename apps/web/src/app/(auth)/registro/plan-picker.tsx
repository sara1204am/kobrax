import { useTranslations } from 'next-intl';
import { PLANS, SIGNUP_PLANS, TRIAL_DAYS, type PlanLimit, type SignupPlan } from '@kobrax/shared';

/**
 * Los cuatro topes que se muestran en la tarjeta.
 *
 * No es la lista completa a propósito: quien se está registrando todavía no conoce el producto y
 * decide con lo que puede entender de un vistazo — cuánta gente, cuánta cartera, cuánta evidencia y
 * por cuánto tiempo. El resto vive en Cuenta, cuando ya está adentro.
 */
const VISIBLES = ['users', 'credits', 'photosPerMonth', 'photoRetentionMonths'] as const;

/**
 * Elegir plan al registrarse (L0.5).
 *
 * ENTERPRISE **no está entre las opciones**: se cotiza, y este formulario sale a un endpoint
 * público. Se muestra al pie para que se vea que la escalera sigue, pero se contesta hablando.
 */
export function PlanPicker({ onPick }: { onPick: (plan: SignupPlan) => void }) {
  const t = useTranslations('registro.plan');
  const tp = useTranslations('plans');

  const valor = (key: (typeof VISIBLES)[number], value: PlanLimit) => {
    if (value === null) return tp('unlimited');
    return key === 'photoRetentionMonths' ? tp('months', { n: value }) : tp('count', { n: value });
  };

  return (
    <div className="space-y-5">
      <ul className="grid gap-4 sm:grid-cols-3">
        {SIGNUP_PLANS.map((code) => {
          const plan = PLANS[code];
          const gratis = code === 'FREE';
          return (
            <li key={code} className="flex">
              <button
                type="button"
                onClick={() => onPick(code)}
                className="group flex w-full flex-col rounded-2xl border-[1.5px] border-k-border p-5 text-left transition-colors hover:border-k-periwinkle focus-visible:border-k-periwinkle focus-visible:shadow-k-focus focus-visible:outline-none"
              >
                <span
                  className={`inline-flex w-fit rounded-lg px-2 py-1 text-[11px] font-medium ${
                    gratis ? 'bg-k-light-bg text-k-text-2' : 'bg-k-highlight text-k-purple'
                  }`}
                >
                  {gratis ? t('forever') : t('trial', { days: TRIAL_DAYS })}
                </span>

                <span className="mt-3 block text-[19px] font-semibold text-k-navy">
                  {tp(`names.${code}`)}
                </span>
                <span className="mt-0.5 block text-[13px] text-k-text-2">
                  {tp(`price.${code}`, { base: plan.price.base, perSeat: plan.price.perSeat })}
                </span>

                <dl className="mt-4 space-y-1.5 border-t border-k-border pt-4">
                  {VISIBLES.map((key) => (
                    <div key={key} className="flex items-baseline justify-between gap-3">
                      <dt className="text-[12px] text-k-text-2">
                        {key === 'users' ? tp('seats') : tp(`limits.${key}`)}
                      </dt>
                      <dd className="text-[13px] font-medium tabular-nums text-k-text">
                        {valor(key, plan.limits[key])}
                      </dd>
                    </div>
                  ))}
                </dl>

                <span className="mt-3 block text-[12px] leading-snug text-k-muted">
                  {tp(`support.${code}`)}
                </span>

                {/* Afordancia de botón al pie: la tarjeta entera es el control, pero sin esto no
                    se lee como algo que se pueda tocar. */}
                <span className="mt-5 block rounded-xl bg-k-bg px-4 py-2.5 text-center text-[14px] font-semibold text-k-navy group-hover:bg-k-navy group-hover:text-white">
                  {t('choose')}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/*
        Sin precio: ENTERPRISE se cotiza, y «desde $800» acá dejaría anclado un número que casi
        nunca va a ser el del contrato.

        ponytail: sin `mailto:` porque el producto todavía no tiene una casilla de contacto
        configurada en ningún lado. El día que exista, es un `<a>` acá y nada más.
      */}
      <p className="rounded-xl bg-k-bg px-4 py-3 text-[13px] leading-relaxed text-k-text-2">
        <span className="font-medium text-k-text">{tp('names.ENTERPRISE')}</span> — {t('enterprise')}
      </p>
    </div>
  );
}
