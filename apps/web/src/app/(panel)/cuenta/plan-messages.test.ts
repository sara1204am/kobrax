import { describe, it, expect } from 'vitest';
import { createTranslator } from 'next-intl';
import { PLANS, PLAN_ORDER } from '@kobrax/shared';
import es from '@/messages/es.json';
import en from '@/messages/en.json';

/**
 * Los textos del plan **se arman con números** (`${perSeat, number}`, plurales, «sin límite»), y
 * next-intl no revienta con un ICU mal escrito: escribe la ruta cruda de la clave en la pantalla y
 * sigue. El type-check tampoco lo ve. Así que se formatean acá, con los valores de verdad del
 * catálogo, en los dos idiomas.
 */
const LOCALES = [
  ['es', es],
  ['en', en],
] as const;

/** Cada mensaje del namespace con los argumentos que le pasa la pantalla. */
const MESSAGES: [string, Record<string, string | number>?][] = [
  ['title'],
  ['includes'],
  ['unlimited'],
  ['upgradeHow'],
  ['seats'],
  ['unknown', { code: 'PRO' }],
  ['seatsValue', { used: 3, max: 5 }],
  ['seatsCustom', { max: 5, plan: 1 }],
  ['count', { n: 25000 }],
  ['months', { n: 24 }],
  ['upgrade', { plan: 'Professional', users: 25, credits: 1000 }],
  ['upgradeTop', { plan: 'Enterprise' }],
  ...PLAN_ORDER.flatMap((code): [string, Record<string, string | number>?][] => [
    [`names.${code}`],
    [`support.${code}`],
    [`price.${code}`, { base: PLANS[code].price.base, perSeat: PLANS[code].price.perSeat }],
  ]),
  ...(['credits', 'clients', 'photosPerMonth', 'actionsPerMonth', 'photoRetentionMonths', 'support'] as const).map(
    (k): [string] => [`limits.${k}`],
  ),
];

describe('los textos del plan', () => {
  it.each(LOCALES)('%s: todos se formatean con sus valores', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'plans' });
    for (const [key, values] of MESSAGES) {
      const text = t(key as never, values as never);
      // next-intl devuelve la ruta de la clave cuando el mensaje falla al formatear.
      expect(text, key).not.toContain(`plans.${key}`);
      // Un argumento que la pantalla no manda queda como `{loQueSea}` a la vista.
      expect(text, key).not.toContain('{');
    }
  });

  it.each(LOCALES)('%s: los plurales concuerdan', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'plans' });
    expect(t('months', { n: 1 })).toBe(locale === 'es' ? '1 mes' : '1 month');
    expect(t('months', { n: 6 })).toBe(locale === 'es' ? '6 meses' : '6 months');
  });
});

describe('el cartel de «no quedan asientos»', () => {
  it.each(LOCALES)('%s: el caso FREE —un solo miembro— está en singular', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'team.atCapacity' });
    // Es el estado normal de una cuenta FREE, no un borde: el plan incluye 1 usuario.
    const uno = t('text', { plan: 'Free', max: PLANS.FREE.limits.users ?? 1 });
    expect(uno).toContain(locale === 'es' ? '1 miembro.' : '1 member.');
    expect(t('text', { plan: 'Business', max: 100 })).toContain(
      locale === 'es' ? '100 miembros' : '100 members',
    );
    expect(t('next', { plan: 'Professional', users: 25 })).not.toContain('{');
  });
});
