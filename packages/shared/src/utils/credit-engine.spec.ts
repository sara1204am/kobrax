import { describe, expect, it } from 'vitest';
import {
  AmortizationMethod,
  CreditDefinition,
  InterestBase,
  InterestType,
  PaymentFrequency,
  RepaymentForm,
} from '../enums/credit.enum.js';
import {
  calculateCredit,
  checkClientInstallment,
  parseCreditTerms,
  quoteLoan,
  resolveCreditTerms,
  type CalculatedTerms,
  type CreditCalculation,
} from './credit-engine.js';

const sum = (xs: number[]): number => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
const codes = (c: CreditCalculation): string[] => c.issues.map((i) => i.code);

function calc(over: Partial<CalculatedTerms> = {}): CreditCalculation {
  return calculateCredit({
    definition: CreditDefinition.CALCULATED,
    principal: 10000,
    ratePercent: 1,
    interestType: InterestType.SIMPLE,
    amortization: AmortizationMethod.FIXED_INSTALLMENT,
    periods: 12,
    frequency: PaymentFrequency.MONTHLY,
    firstDueDate: '2026-10-25',
    ...over,
  });
}

/**
 * 🔴 Las invariantes que hacen que un plan sea cobrable: el capital se devuelve entero, el total es
 * la suma de las cuotas y el saldo termina en 0. Se prueban en TODAS las combinaciones válidas (D4)
 * y con montos/plazos que no dividen exacto, que es donde el redondeo se equivoca.
 */
describe('calculateCredit — invariantes en todas las combinaciones válidas', () => {
  const combos: [InterestType, AmortizationMethod][] = [
    [InterestType.SIMPLE, AmortizationMethod.FIXED_INSTALLMENT],
    [InterestType.SIMPLE, AmortizationMethod.FIXED_PRINCIPAL],
    [InterestType.SIMPLE, AmortizationMethod.SINGLE_PAYMENT],
    [InterestType.COMPOUND, AmortizationMethod.FIXED_INSTALLMENT],
    [InterestType.COMPOUND, AmortizationMethod.SINGLE_PAYMENT],
  ];
  const principals = [1000, 999.99, 5000, 12345.67];
  const rates = [0, 1, 3.5, 10];
  const periods = [1, 3, 7, 12, 24];

  for (const [interestType, amortization] of combos) {
    it(`${interestType} + ${amortization}`, () => {
      for (const principal of principals) {
        for (const ratePercent of rates) {
          for (const n of periods) {
            const r = calc({ interestType, amortization, principal, ratePercent, periods: n });
            expect(r.ok).toBe(true);
            const s = r.schedule!;
            expect(s.length).toBe(amortization === AmortizationMethod.SINGLE_PAYMENT ? 1 : n);
            expect(sum(s.map((x) => x.principal))).toBe(principal);
            expect(sum(s.map((x) => x.amount))).toBe(r.quote!.total);
            expect(s[s.length - 1]!.principalBalance).toBe(0);
            expect(r.quote!.profit).toBe(Math.round((r.quote!.total! - principal) * 100) / 100);
            for (const row of s) expect(Math.round((row.principal + row.interest) * 100) / 100).toBe(row.amount);
          }
        }
      }
    });
  }
});

describe('calculateCredit — calculado', () => {
  it('el ejemplo del PDF: 1.000 al 10% por período en 5 cuotas → 300 / 1.500 / 500', () => {
    const r = calc({ principal: 1000, ratePercent: 10, periods: 5 });
    expect(r.quote).toEqual({ installment: 300, installmentVaries: false, installmentsCount: 5, total: 1500, profit: 500 });
    expect(r.schedule!.map((x) => x.interest)).toEqual([100, 100, 100, 100, 100]);
  });

  it('base "% del total": 1.000 al 10% total en 5 → cuota 220, total 1.100', () => {
    const r = calc({ principal: 1000, ratePercent: 10, periods: 5, rateBase: InterestBase.TOTAL });
    expect(r.quote).toMatchObject({ installment: 220, total: 1100, profit: 100 });
  });

  it('compuesto + cuota fija = anualidad (francés): 10.000 al 1% en 12 → 888,49', () => {
    const r = calc({ interestType: InterestType.COMPOUND });
    expect(r.quote!.installment).toBe(888.49);
    expect(r.schedule![0]!.interest).toBe(100); // 1% del saldo inicial
    expect(r.schedule![11]!.interest).toBeLessThan(r.schedule![0]!.interest); // el interés baja con el saldo
  });

  it('simple + capital fijo: capital parejo, interés sobre el saldo → la cuota baja', () => {
    const r = calc({ principal: 1200, ratePercent: 1, periods: 3, amortization: AmortizationMethod.FIXED_PRINCIPAL });
    expect(r.schedule!.map((x) => x.amount)).toEqual([412, 408, 404]);
    expect(r.quote).toMatchObject({ installment: 412, installmentVaries: true, total: 1224 });
  });

  it('pago único simple vs compuesto: 1.000 al 10% por 2 períodos → 1.200 vs 1.210', () => {
    const simple = calc({ principal: 1000, ratePercent: 10, periods: 2, amortization: AmortizationMethod.SINGLE_PAYMENT });
    const compound = calc({
      principal: 1000,
      ratePercent: 10,
      periods: 2,
      amortization: AmortizationMethod.SINGLE_PAYMENT,
      interestType: InterestType.COMPOUND,
    });
    expect(simple.schedule).toEqual([
      { number: 1, dueDate: '2026-10-25', principal: 1000, interest: 200, amount: 1200, principalBalance: 0 },
    ]);
    expect(compound.quote!.total).toBe(1210);
  });

  // El ejemplo del pedido: 4 cuotas trimestrales desde el 25/10/2026.
  it('fechas trimestrales desde el primer pago', () => {
    const r = calc({ periods: 4, frequency: PaymentFrequency.QUARTERLY });
    expect(r.schedule!.map((x) => x.dueDate)).toEqual(['2026-10-25', '2027-01-25', '2027-04-25', '2027-07-25']);
  });

  it('fin de mes: un plan que arranca el 31 conserva el 31 donde existe (D6)', () => {
    const r = calc({ periods: 4, firstDueDate: '2026-01-31' });
    expect(r.schedule!.map((x) => x.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('D4: compuesto + capital fijo no se ofrece', () => {
    const r = calc({ interestType: InterestType.COMPOUND, amortization: AmortizationMethod.FIXED_PRINCIPAL });
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain('COMBINATION_NOT_SUPPORTED');
    expect(r.quote).toBeNull();
  });

  it('D8: la base "% del total" sólo con simple + cuota fija', () => {
    const r = calc({ interestType: InterestType.COMPOUND, rateBase: InterestBase.TOTAL });
    expect(codes(r)).toEqual(['RATE_BASE_NOT_SUPPORTED']);
    expect(r.ok).toBe(false);
  });

  it('tasa fuera de rango: calcula (la pantalla muestra el número) pero no se puede guardar', () => {
    const r = calc({ ratePercent: 150 });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['RATE_OUT_OF_RANGE']);
    expect(r.quote).not.toBeNull();
    expect(calc({ ratePercent: 150, rateBase: InterestBase.TOTAL }).ok).toBe(true); // % total admite hasta 500
  });

  it('datos que impiden calcular', () => {
    expect(codes(calc({ principal: 0 }))).toContain('PRINCIPAL_INVALID');
    expect(codes(calc({ ratePercent: -1 }))).toContain('RATE_INVALID');
    expect(codes(calc({ periods: 0 }))).toContain('PERIODS_INVALID');
    expect(codes(calc({ periods: 2.5 }))).toContain('PERIODS_INVALID');
    expect(codes(calc({ periods: 601 }))).toContain('PERIODS_INVALID');
    expect(calc({ principal: Number.NaN }).quote).toBeNull();
  });

  it('fecha inválida: hay cotización, no hay plan', () => {
    const r = calc({ firstDueDate: '2026-02-30' });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(['DATE_INVALID']);
    expect(r.quote).not.toBeNull();
    expect(r.schedule).toBeNull();
  });
});

describe('calculateCredit — cuota acordada (la cuota del usuario manda, D14)', () => {
  it('Bs 5.000 con cuota de Bs 550 en 10 → total 5.500, ganancia 500', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_INSTALLMENT,
      principal: 5000,
      installmentAmount: 550,
      installmentsCount: 10,
      frequency: PaymentFrequency.MONTHLY,
      firstDueDate: '2026-10-25',
    });
    expect(r.ok).toBe(true);
    expect(r.quote).toEqual({ installment: 550, installmentVaries: false, installmentsCount: 10, total: 5500, profit: 500 });
    // D11: capital = P/n, interés = cuota − P/n.
    expect(r.schedule!.every((x) => x.principal === 500 && x.interest === 50 && x.amount === 550)).toBe(true);
  });

  it('el motor no reemplaza la cuota acordada aunque una tasa dé otra cifra', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_INSTALLMENT,
      principal: 1000,
      installmentAmount: 115, // el motor calcularía 110 al 1% simple — acá manda el acuerdo
      installmentsCount: 10,
      frequency: PaymentFrequency.MONTHLY,
      firstDueDate: '2026-10-25',
    });
    expect(r.quote!.installment).toBe(115);
    expect(r.quote!.total).toBe(1150);
  });

  it('D12: sin número de cuotas es un préstamo abierto — hay cuota, no hay plan', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_INSTALLMENT,
      principal: 1000,
      installmentAmount: 50,
      frequency: PaymentFrequency.WEEKLY,
      firstDueDate: '2026-10-25',
    });
    expect(r.ok).toBe(true);
    expect(r.quote).toEqual({ installment: 50, installmentVaries: false, installmentsCount: null, total: null, profit: null });
    expect(r.schedule).toBeNull();
  });

  it('cobrar menos de lo prestado es un aviso, no un error (se puede guardar)', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_INSTALLMENT,
      principal: 1000,
      installmentAmount: 275,
      installmentsCount: 3,
      frequency: PaymentFrequency.MONTHLY,
      firstDueDate: '2026-10-25',
    });
    expect(r.ok).toBe(true);
    expect(r.issues).toEqual([{ code: 'TOTAL_BELOW_PRINCIPAL', severity: 'warning' }]);
    expect(r.quote!.profit).toBe(-175);
  });
});

describe('calculateCredit — total acordado (el total manda, sin inventar tasa)', () => {
  // «Te presto Bs 1.000 y en dos meses me devolvés Bs 1.500.»
  it('pago único: un solo pago del total en la fecha acordada', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_TOTAL,
      principal: 1000,
      agreedTotal: 1500,
      repayment: RepaymentForm.SINGLE,
      firstDueDate: '2026-11-25',
    });
    expect(r.ok).toBe(true);
    expect(r.quote).toEqual({ installment: 1500, installmentVaries: false, installmentsCount: 1, total: 1500, profit: 500 });
    expect(r.schedule).toEqual([
      { number: 1, dueDate: '2026-11-25', principal: 1000, interest: 500, amount: 1500, principalBalance: 0 },
    ]);
  });

  it('en cuotas: el total repartido → cuota resultante', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_TOTAL,
      principal: 1000,
      agreedTotal: 1500,
      repayment: RepaymentForm.INSTALLMENTS,
      installmentsCount: 2,
      frequency: PaymentFrequency.MONTHLY,
      firstDueDate: '2026-10-25',
    });
    expect(r.schedule!.map((x) => [x.dueDate, x.amount])).toEqual([
      ['2026-10-25', 750],
      ['2026-11-25', 750],
    ]);
  });

  it('en cuotas que no dividen exacto: la última absorbe y el total se respeta', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_TOTAL,
      principal: 1000,
      agreedTotal: 1000,
      repayment: RepaymentForm.INSTALLMENTS,
      installmentsCount: 3,
      frequency: PaymentFrequency.MONTHLY,
      firstDueDate: '2026-10-25',
    });
    expect(r.schedule!.map((x) => x.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(r.quote!.total).toBe(1000);
  });

  it('en cuotas exige número y frecuencia', () => {
    const r = calculateCredit({
      definition: CreditDefinition.AGREED_TOTAL,
      principal: 1000,
      agreedTotal: 1500,
      repayment: RepaymentForm.INSTALLMENTS,
      firstDueDate: '2026-10-25',
    });
    expect(r.ok).toBe(false);
    expect(codes(r)).toEqual(expect.arrayContaining(['FREQUENCY_REQUIRED', 'PERIODS_INVALID']));
  });
});

/**
 * 🔴 Paridad con la fórmula que web y móvil usan hoy. La **cuota** —lo único que se guarda de un
 * crédito sin cronograma— tiene que salir idéntica, céntimo a céntimo: si no, un préstamo recotizado
 * cambiaría de cuota sin que nadie lo pidiera.
 */
describe('quoteLoan — paridad con la fórmula anterior', () => {
  const round2 = (x: number): number => Math.round(x * 100) / 100;
  const legacyInstallment = (P: number, i: number, n: number, base: InterestBase): number =>
    base === InterestBase.TOTAL ? round2((P * (1 + i / 100)) / n) : round2(P / n + (P * i) / 100);

  it('misma cuota en toda la grilla', () => {
    for (const base of [InterestBase.PER_PERIOD, InterestBase.TOTAL]) {
      for (const P of [100, 999.99, 1000, 1234.56, 5000, 25000]) {
        for (const i of [0, 1, 2.5, 7, 10, 20, 33.33]) {
          for (const n of [1, 2, 3, 5, 7, 12, 30]) {
            if (base === InterestBase.TOTAL && P === 100 && i === 33.33 && n === 2) continue; // empate, abajo
            expect(quoteLoan({ principal: P, interestPercent: i, installments: n, base }).installment).toBe(
              legacyInstallment(P, i, n, base),
            );
          }
        }
      }
    }
  });

  // La única diferencia de la grilla: un empate exacto en medio céntimo (66,665). La fórmula anterior
  // redondeaba en coma flotante y caía a 66,66 por el error de representación; el motor redondea en
  // céntimos enteros, siempre hacia arriba en el empate.
  it('empate en medio céntimo: el motor redondea hacia arriba, determinista', () => {
    expect(legacyInstallment(100, 33.33, 2, InterestBase.TOTAL)).toBe(66.66);
    expect(quoteLoan({ principal: 100, interestPercent: 33.33, installments: 2, base: InterestBase.TOTAL }).installment).toBe(66.67);
  });

  // Antes el total era `cuota × n` (1.299,99) aunque se cobrara una cuota final de 433,34: el total
  // mostrado ahora es el que realmente cuesta el préstamo.
  it('el total es Σ cuotas del plan, no cuota × n', () => {
    expect(quoteLoan({ principal: 1000, interestPercent: 10, installments: 3 })).toEqual({
      installment: 433.33,
      total: 1300,
      profit: 300,
    });
  });
});

describe('checkClientInstallment — D14 en el crédito calculado', () => {
  it('igual, redondeo y diferencia real', () => {
    expect(checkClientInstallment(110, 110)).toBe('match');
    expect(checkClientInstallment(110, undefined)).toBe('match');
    expect(checkClientInstallment(110, 109.99)).toBe('normalized');
    expect(checkClientInstallment(110, 110.01)).toBe('normalized');
    expect(checkClientInstallment(110, 110.02)).toBe('mismatch');
    expect(checkClientInstallment(110, 120)).toBe('mismatch');
  });
});

describe('parseCreditTerms — forma de lo que llega de afuera', () => {
  const base = { principal: 1000, firstDueDate: '2026-10-25' };

  it('acepta cada definición y descarta claves desconocidas', () => {
    expect(
      parseCreditTerms({ ...base, definition: 'agreed_installment', installmentAmount: 115, installmentsCount: 10, frequency: 'MONTHLY', hack: 1 }),
    ).toEqual({ ...base, definition: 'agreed_installment', installmentAmount: 115, installmentsCount: 10, frequency: 'MONTHLY' });
    expect(parseCreditTerms({ ...base, definition: 'agreed_total', agreedTotal: 1500, repayment: 'single' })).toEqual({
      ...base,
      definition: 'agreed_total',
      agreedTotal: 1500,
      repayment: 'single',
    });
    expect(
      parseCreditTerms({ ...base, definition: 'calculated', ratePercent: 10, interestType: 'simple', amortization: 'fixed_installment', periods: 5, frequency: 'MONTHLY' }),
    ).not.toBeNull();
  });

  it('rechaza tipos y enums inválidos', () => {
    expect(parseCreditTerms(null)).toBeNull();
    expect(parseCreditTerms([])).toBeNull();
    expect(parseCreditTerms({ ...base, definition: 'otra' })).toBeNull();
    expect(parseCreditTerms({ ...base, principal: '1000', definition: 'agreed_total', agreedTotal: 1500, repayment: 'single' })).toBeNull();
    expect(parseCreditTerms({ ...base, definition: 'agreed_installment', installmentAmount: 115, frequency: 'CADA_TANTO' })).toBeNull();
    expect(
      parseCreditTerms({ ...base, definition: 'calculated', ratePercent: 10, interestType: 'simple', amortization: 'fixed_installment', periods: 5, frequency: 'MONTHLY', rateBase: 'X' }),
    ).toBeNull();
  });
});

/**
 * 🔴 D14 — quién manda según el modo. El caso que la motivó: capital 1.000, 10 cuotas; el motor
 * calcula 110 pero el prestamista cobra 115. En «cuota acordada» 115 es el acuerdo; en «calculado»
 * sería una segunda cifra para el mismo crédito, y eso no se guarda.
 */
describe('resolveCreditTerms — D14', () => {
  const calculated: CalculatedTerms = {
    definition: CreditDefinition.CALCULATED,
    principal: 1000,
    ratePercent: 1,
    interestType: InterestType.SIMPLE,
    amortization: AmortizationMethod.FIXED_INSTALLMENT,
    periods: 10,
    frequency: PaymentFrequency.MONTHLY,
    firstDueDate: '2026-10-25',
  };

  it('calculado: sin cuota del cliente, guarda la del motor', () => {
    const r = resolveCreditTerms(calculated, { principalAmount: 1000 });
    expect(r).toMatchObject({ ok: true, installmentAmount: 110, installmentsCount: 10, totalToCollect: 1100, nextDueDate: '2026-10-25', interestRatePercent: 1, normalized: false });
  });

  it('calculado: un céntimo de diferencia se normaliza a la del motor', () => {
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, installmentAmount: 109.99 })).toMatchObject({ ok: true, installmentAmount: 110, normalized: true });
  });

  it('calculado: una cuota distinta se rechaza — no hay dos cifras para el mismo modo', () => {
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, installmentAmount: 115 })).toEqual({
      ok: false,
      code: 'INSTALLMENT_MISMATCH',
      expected: 110,
      sent: 115,
    });
  });

  it('cuota acordada: 115 es el acuerdo y se guarda tal cual', () => {
    const r = resolveCreditTerms(
      { definition: CreditDefinition.AGREED_INSTALLMENT, principal: 1000, installmentAmount: 115, installmentsCount: 10, frequency: PaymentFrequency.MONTHLY, firstDueDate: '2026-10-25' },
      { principalAmount: 1000, installmentAmount: 115 },
    );
    expect(r).toMatchObject({ ok: true, installmentAmount: 115, totalToCollect: 1150, interestRatePercent: 0 });
  });

  it('cuota acordada: ni un céntimo de tolerancia (es el acuerdo, no un redondeo)', () => {
    const r = resolveCreditTerms(
      { definition: CreditDefinition.AGREED_INSTALLMENT, principal: 1000, installmentAmount: 115, installmentsCount: 10, frequency: PaymentFrequency.MONTHLY, firstDueDate: '2026-10-25' },
      { principalAmount: 1000, installmentAmount: 115.01 },
    );
    expect(r).toMatchObject({ ok: false, code: 'INSTALLMENT_MISMATCH' });
  });

  it('cuota acordada sin número: préstamo abierto, 0 cuotas y sin total', () => {
    const r = resolveCreditTerms(
      { definition: CreditDefinition.AGREED_INSTALLMENT, principal: 1000, installmentAmount: 50, frequency: PaymentFrequency.WEEKLY, firstDueDate: '2026-10-25' },
      { principalAmount: 1000 },
    );
    expect(r).toMatchObject({ ok: true, installmentAmount: 50, installmentsCount: 0, totalToCollect: null, frequency: 'WEEKLY' });
  });

  it('total acordado en pago único: cuota = total, 1 cuota, sin frecuencia propia', () => {
    const r = resolveCreditTerms(
      { definition: CreditDefinition.AGREED_TOTAL, principal: 1000, agreedTotal: 1500, repayment: RepaymentForm.SINGLE, firstDueDate: '2026-11-25' },
      { principalAmount: 1000 },
    );
    expect(r).toMatchObject({ ok: true, installmentAmount: 1500, installmentsCount: 1, totalToCollect: 1500, frequency: 'MONTHLY', nextDueDate: '2026-11-25' });
  });

  it('un campo suelto que contradice las condiciones se rechaza', () => {
    expect(resolveCreditTerms(calculated, { principalAmount: 999 })).toEqual({ ok: false, code: 'TERMS_CONFLICT', field: 'principalAmount' });
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, installmentsCount: 12 })).toMatchObject({ field: 'installmentsCount' });
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, frequency: PaymentFrequency.WEEKLY })).toMatchObject({ field: 'frequency' });
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, nextDueDate: '2026-11-01' })).toMatchObject({ field: 'nextDueDate' });
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, interestRate: 0.01 })).toMatchObject({ field: 'interestRate' });
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, amortizationType: 'FRENCH' })).toMatchObject({ field: 'amortizationType' });
    // Los que coinciden pasan.
    expect(resolveCreditTerms(calculated, { principalAmount: 1000, installmentsCount: 10, frequency: PaymentFrequency.MONTHLY, nextDueDate: '2026-10-25', interestRate: 1 }).ok).toBe(true);
  });

  it('capital fijo (cuota variable): se resuelve con su cronograma, que la API guarda fila por fila', () => {
    const r = resolveCreditTerms({ ...calculated, amortization: AmortizationMethod.FIXED_PRINCIPAL }, { principalAmount: 1000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schedule).toHaveLength(10);
    expect(r.installmentAmount).toBe(r.schedule![0]!.amount); // la primera, la más alta
    expect(r.schedule![9]!.amount).toBeLessThan(r.schedule![0]!.amount);
  });

  it('cuota fija: sin cronograma (se congela la cuota)', () => {
    const r = resolveCreditTerms(calculated, { principalAmount: 1000 });
    expect(r.ok && r.schedule).toBeNull();
  });

  it('condiciones que el motor no puede calcular', () => {
    expect(resolveCreditTerms({ ...calculated, ratePercent: 150 }, { principalAmount: 1000 })).toEqual({
      ok: false,
      code: 'TERMS_INVALID',
      issues: ['RATE_OUT_OF_RANGE'],
    });
  });
});
