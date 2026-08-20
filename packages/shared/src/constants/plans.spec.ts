import { describe, expect, it } from 'vitest';
import {
  PLANS,
  PLAN_ORDER,
  SIGNUP_PLANS,
  effectiveLimits,
  isSignupPlan,
  nextPlan,
  planOf,
  usageLevel,
  type PlanCode,
} from './plans.js';

describe('planOf', () => {
  it('🔴 STARTER es el nombre viejo del FREE en la base', () => {
    // El enum de Prisma todavía dice STARTER: si esto no traduce, toda cuenta existente cae en
    // «plan desconocido» y la pantalla no muestra ningún tope.
    expect(planOf('STARTER')).toBe(PLANS.FREE);
    expect(planOf('FREE')).toBe(PLANS.FREE);
  });

  it('un código desconocido no se inventa un plan', () => {
    expect(planOf('PRO')).toBeUndefined();
    expect(planOf('')).toBeUndefined();
  });
});

describe('nextPlan', () => {
  it('devuelve el escalón de arriba', () => {
    expect(nextPlan('STARTER')).toBe(PLANS.PROFESSIONAL);
    expect(nextPlan('PROFESSIONAL')).toBe(PLANS.BUSINESS);
  });

  it('el último no tiene siguiente', () => {
    expect(nextPlan('ENTERPRISE')).toBeUndefined();
    expect(nextPlan('PRO')).toBeUndefined();
  });
});

describe('effectiveLimits', () => {
  it('sin excepción rigen los del plan', () => {
    expect(effectiveLimits('PROFESSIONAL')).toEqual(PLANS.PROFESSIONAL.limits);
    expect(effectiveLimits('STARTER', null)).toEqual(PLANS.FREE.limits);
  });

  it('🔴 la excepción pisa sólo lo negociado', () => {
    // Es lo que sostiene «nadie pierde asientos» al estrenar los planes: una cuenta vieja con 5
    // los conserva, y todo lo demás lo sigue diciendo su plan.
    const limits = effectiveLimits('FREE', { users: 5 });
    expect(limits.users).toBe(5);
    expect(limits.credits).toBe(PLANS.FREE.limits.credits);
  });

  it('acepta null como «sin tope» para el caso negociado', () => {
    expect(effectiveLimits('BUSINESS', { credits: null }).credits).toBeNull();
  });

  it('🔴 lo que viene de la base es JSON, y no todo JSON es un tope', () => {
    // `limits_override` es una columna jsonb: adentro puede haber cualquier cosa. Un valor
    // basura que se colara como tope deja a la cuenta sin freno o la deja sin poder trabajar.
    const sucio = effectiveLimits('FREE', {
      users: '99',
      credits: -1,
      clients: Number.NaN,
      photosPerMonth: undefined,
      loQueSea: 1000,
    });
    expect(sucio).toEqual(PLANS.FREE.limits);
  });

  it('un plan que no existe cae al tope MAS CHICO, no al mayor', () => {
    // Si el codigo de plan quedo mal escrito, lo seguro es quedarse corto: una cuenta apretada
    // llama por telefono, una sin techo no la ve nadie.
    expect(effectiveLimits('LO_QUE_SEA')).toEqual(PLANS.FREE.limits);
  });
});

describe('usageLevel', () => {
  it('🔴 avisa al 80% y no antes', () => {
    expect(usageLevel(19, 25)).toBe('ok');
    expect(usageLevel(20, 25)).toBe('near');
    expect(usageLevel(24, 25)).toBe('near');
  });

  it('lleno es lleno, aunque se haya pasado', () => {
    // Bajar de plan deja cuentas POR ENCIMA del tope (LIMITES §8.1): 14 de 5 no es «ok».
    expect(usageLevel(25, 25)).toBe('full');
    expect(usageLevel(14, 5)).toBe('full');
  });

  it('sin tope no hay alarma', () => {
    expect(usageLevel(9999, null)).toBe('ok');
  });
});

describe('isSignupPlan', () => {
  it('🔴 ENTERPRISE no se puede elegir al registrarse', () => {
    // `POST /accounts` es público: si esto deja pasar ENTERPRISE, cualquiera se crea una cuenta
    // sin ningún tope mandando el código con curl.
    expect(isSignupPlan('ENTERPRISE')).toBe(false);
    expect(isSignupPlan('STARTER')).toBe(false);
    expect(isSignupPlan('')).toBe(false);
    expect(isSignupPlan(undefined)).toBe(false);
    expect(isSignupPlan({ toString: () => 'FREE' })).toBe(false);
  });

  it('los tres elegibles son planes de verdad', () => {
    expect(SIGNUP_PLANS.every(isSignupPlan)).toBe(true);
    expect(SIGNUP_PLANS.every((c) => planOf(c) !== undefined)).toBe(true);
  });
});

describe('la escalera', () => {
  it('🔴 ningún plan SaaS queda sin tope', () => {
    // Un tope en `null` no se cuenta, así que no se ve ni avisa: nadie se entera de que un cliente
    // consume cinco veces lo cotizado hasta que lo dice la base. Y en multi-tenant, un inquilino
    // sin techo es riesgo de todos. `null` es sólo para Licencia, que corre fuera de acá.
    for (const code of PLAN_ORDER) {
      for (const [key, value] of Object.entries(PLANS[code].limits)) {
        expect(value, `${code}.${key}`).not.toBeNull();
      }
    }
  });

  it('🔴 subir de plan nunca sale más barato', () => {
    // La grilla vieja tenía ENTERPRISE plano en $800 y BUSINESS a $99 + $10 por cobrador: con 80
    // cobradores, BUSINESS costaba $899. A partir de ~71 convenía pedir el plan de arriba, que
    // además venía sin topes. La inversión no se ve mirando la tabla; se ve haciendo la cuenta.
    const mensual = (p: (typeof PLANS)[PlanCode], asientos: number) =>
      p.price.base + p.price.perSeat * asientos;

    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const bajo = PLANS[PLAN_ORDER[i - 1]!];
      const alto = PLANS[PLAN_ORDER[i]!];
      // Al tope de asientos del plan de abajo, que es justo donde alguien se plantea subir.
      const asientos = bajo.limits.users ?? 1;
      expect(mensual(alto, asientos), `${alto.code} vs ${bajo.code}`).toBeGreaterThanOrEqual(
        mensual(bajo, asientos),
      );
    }
  });

  it('los topes nunca bajan al subir de plan', () => {
    // Un plan más caro con menos de algo es un error de tipeo en la grilla, y se vende igual.
    for (let i = 1; i < PLAN_ORDER.length; i++) {
      const bajo = PLANS[PLAN_ORDER[i - 1]!].limits;
      const alto = PLANS[PLAN_ORDER[i]!].limits;
      for (const key of Object.keys(bajo) as (keyof typeof bajo)[]) {
        const a = alto[key];
        const b = bajo[key];
        // `null` = sin límite, así que siempre es mayor.
        expect(a === null || (b !== null && a >= b), `${PLAN_ORDER[i]}.${key}`).toBe(true);
      }
    }
  });
});
