import type { ReactNode } from 'react';
import { getLocale, getTranslations } from 'next-intl/server';
import { nextPlan, planOf, usageLevel, type AccountInfo, type PlanLimit } from '@kobrax/shared';
import { Section } from '@/components/panel-ui';
import { exceededLimits, trialDaysLeft } from '@/lib/plan-view';
import { nextMonthName } from './month-name';

/**
 * Los topes **que se cuentan**, con barra. Cada fase que agrega un contador agrega su clave acá y
 * su número aparece solo: el servidor ya lo manda en `usage`. Desde L2, fotos y gestiones se
 * cuentan por mes — su barra lleva debajo el renglón de «se reinicia el 1».
 */
const CONTADOS = ['users', 'credits', 'clients', 'photosPerMonth', 'actionsPerMonth'] as const;

/**
 * Los que todavía no se cuentan: se listan como texto, sin barra.
 *
 * 🔴 Dibujarles una barra vacía diría «llevás cero», que es mentira — nadie los está contando.
 * Un tope sin contador se describe, no se mide.
 */
const DESCRITOS = ['photoRetentionMonths'] as const;

/** Los estados que `account.status.*` sabe nombrar; otro valor se muestra tal cual. */
const ESTADOS = new Set(['ACTIVE', 'TRIAL', 'SUSPENDED', 'INACTIVE', 'CANCELLED']);

/** El día en que termina la prueba, en el huso de la cuenta (no el del servidor). */
function fechaFin(iso: string, locale: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: timezone ?? 'UTC' }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));
  }
}

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
  const ta = await getTranslations('account');
  const locale = await getLocale();
  const plan = planOf(account.planCode);
  const next = nextPlan(account.planCode);
  const asientos = account.limits.users;
  // Los mensuales se reinician el 1 (Pregunta 13: día 1, no aniversario). Un solo renglón para
  // los dos: dicen lo mismo y repetirlo es ruido.
  const hayMensuales =
    account.limits.photosPerMonth !== null || account.limits.actionsPerMonth !== null;

  const trialDays = account.status === 'TRIAL' ? trialDaysLeft(account.trialEndsAt) : null;
  const excedidos = exceededLimits(account);

  const limitText = (value: PlanLimit) =>
    value === null ? t('unlimited') : t('months', { n: value });

  return (
    <Section title={t('title')} inner="p-6">
      {/* Lo primero que se lee: qué plan, en qué estado y cuánta gente. Las barras vienen después. */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Resumen label={t('summary.plan')}>
          <p className="text-[20px] font-semibold text-k-navy">
            {plan ? t(`names.${plan.code}`) : t('unknown', { code: account.planCode })}
          </p>
          {plan && (
            <p className="mt-0.5 text-[13px] text-k-text-2">
              {t(`price.${plan.code}`, { base: plan.price.base, perSeat: plan.price.perSeat })}
            </p>
          )}
        </Resumen>

        <Resumen label={t('summary.state')}>
          <p className="text-[20px] font-semibold text-k-navy">
            {trialDays !== null
              ? t('summary.trialLeft', { n: trialDays })
              : ESTADOS.has(account.status)
                ? ta(`status.${account.status}`)
                : account.status}
          </p>
          {trialDays !== null && account.trialEndsAt && (
            <p className="mt-0.5 text-[13px] text-k-text-2">
              {t('summary.trialUntil', { date: fechaFin(account.trialEndsAt, locale, account.timezone) })}
            </p>
          )}
        </Resumen>

        <Resumen label={t('summary.members')}>
          <p className="text-[20px] font-semibold tabular-nums text-k-navy">
            {asientos === null
              ? t('count', { n: account.usage.users })
              : t('seatsValue', { used: account.usage.users, max: asientos })}
          </p>
        </Resumen>
      </div>

      {excedidos.length > 0 && (
        // Congelado: se pasó de un tope (al vencer la prueba o bajar de plan). No es un error ni se
        // pierde nada — se dice qué se puede y qué no, antes de que el equipo choque con el bloqueo.
        <div role="status" className="mt-5 rounded-xl border border-k-warning/40 bg-k-highlight px-4 py-3">
          <p className="text-[14px] font-semibold text-k-navy">{t('frozen.title', { n: excedidos.length })}</p>
          <p className="mt-1 text-[13px] leading-relaxed text-k-text-2">
            {t('frozen.text', {
              limits: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(
                excedidos.map((key) => (key === 'users' ? t('seats') : t(`limits.${key}`))),
              ),
            })}
          </p>
        </div>
      )}

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
        {hayMensuales && (
          <p className="text-[13px] text-k-text-2">
            {t('resets', { month: nextMonthName(locale, account.timezone) })}
          </p>
        )}
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
                  {limitText(account.limits[key])}
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

/** Un dato grande del encabezado del plan. */
function Resumen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-k-light-bg px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}
