import { describe, expect, it } from 'vitest';
import { accrueLateInterest, lateTrancheCharge, type LateInterestParams } from './late-interest.js';

const P18: LateInterestParams = { annualRate: 18, dayCount: 365, graceDays: 0 };
const DUE = '2026-01-31';
/** `DUE` + n días. */
const plus = (n: number, from = DUE): string => new Date(Date.parse(`${from}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

describe('lateTrancheCharge — aritmética entera', () => {
  it('1.000 al 18 % anual, 30 días, año de 365: 1000 × 0,18 × 30 / 365 = 14,79 (half-up)', () => {
    expect(lateTrancheCharge(100_000, 18, 30, 365)).toBe(1479);
  });
  it('con año de 360 la misma cuenta da exacto: 15,00', () => {
    expect(lateTrancheCharge(100_000, 18, 30, 360)).toBe(1500);
  });
  it('half-up: 0,5 de centavo sube', () => {
    // 100 centavos × 5 % × 1 día / 360 = 0,01388… → 0 ; 100 centavos × 36 % × 5 / 360 = 0,5 → 1
    expect(lateTrancheCharge(100, 5, 1, 360)).toBe(0);
    expect(lateTrancheCharge(100, 36, 5, 360)).toBe(1);
  });
  it('acepta 4 decimales de tasa sin ruido de punto flotante (12,3456 %)', () => {
    // 1.000.000 centavos × 12,3456 % × 365 / 365 = 123.456 centavos
    expect(lateTrancheCharge(1_000_000, 12.3456, 365, 365)).toBe(123_456);
  });
  it('no devenga con base, días o tasa en cero o negativos', () => {
    expect(lateTrancheCharge(0, 18, 10, 365)).toBe(0);
    expect(lateTrancheCharge(100_000, 18, 0, 365)).toBe(0);
    expect(lateTrancheCharge(100_000, 0, 10, 365)).toBe(0);
    expect(lateTrancheCharge(-5, 18, 10, 365)).toBe(0);
  });
  it('un capital enorme no pierde centavos (BigInt): 90 mil millones al 100 % durante 365 días', () => {
    expect(lateTrancheCharge(9_000_000_000_000, 100, 365, 365)).toBe(9_000_000_000_000);
  });
});

describe('accrueLateInterest — una cuota', () => {
  it('el día del vencimiento todavía no hay mora; el siguiente corre el primer día', () => {
    expect(accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: DUE }).accruedCents).toBe(0);
    expect(accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(1) }).tranches[0]?.days).toBe(1);
  });

  it('sin pagos: un solo tramo con la base completa', () => {
    const r = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(30) });
    expect(r.tranches).toEqual([{ from: DUE, to: plus(30), days: 30, baseCents: 100_000, chargeCents: 1479 }]);
    expect(r.accruedCents).toBe(1479);
    expect(r.daysAccrued).toBe(30);
    expect(r.capped).toBe(false);
  });

  it('D2/D4: un pago de capital CIERRA el tramo en su fecha de cobro y baja la base', () => {
    const r = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(30), events: [{ date: plus(10), principal: 400 }] });
    expect(r.tranches.map((t) => [t.days, t.baseCents, t.chargeCents])).toEqual([
      [10, 100_000, 493], // 1000 × 0,18 × 10 / 365 = 4,93
      [20, 60_000, 592], //  600 × 0,18 × 20 / 365 = 5,92
    ]);
    expect(r.accruedCents).toBe(1085);
  });

  it('pagar TODO el capital detiene el devengo: lo posterior no suma nada', () => {
    const at10 = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(10), events: [{ date: plus(10), principal: 1000 }] });
    const at90 = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(90), events: [{ date: plus(10), principal: 1000 }] });
    expect(at90.accruedCents).toBe(at10.accruedCents);
    expect(at90.accruedCents).toBe(493);
  });

  it('un pago que no toca capital (sólo cubrió mora o interés corriente) no mueve la base: no va como evento', () => {
    const a = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(30) });
    const b = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(30), events: [{ date: plus(10), principal: 0 }] });
    expect(b).toEqual(a);
  });

  it('P2 gracia: durante la gracia no corre y al terminar NO se cobra hacia atrás', () => {
    const grace5 = { ...P18, graceDays: 5 };
    expect(accrueLateInterest({ dueDate: DUE, principal: 1000, policy: grace5, asOf: plus(5) }).accruedCents).toBe(0);
    expect(accrueLateInterest({ dueDate: DUE, principal: 1000, policy: grace5, asOf: plus(6) }).daysAccrued).toBe(1);
    // 10 días de atraso − 5 de gracia = 5 días: 1000 × 0,18 × 5 / 365 = 2,47
    expect(accrueLateInterest({ dueDate: DUE, principal: 1000, policy: grace5, asOf: plus(10) }).accruedCents).toBe(247);
  });

  it('un pago DURANTE la gracia baja la base sin cobrar nada, y después corre sobre lo que quedó', () => {
    const r = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: { ...P18, graceDays: 5 }, asOf: plus(15), events: [{ date: plus(3), principal: 500 }] });
    expect(r.tranches).toHaveLength(1);
    expect(r.tranches[0]).toMatchObject({ days: 10, baseCents: 50_000 });
  });

  it('D3: el año de 360 cobra más por día que el de 365', () => {
    const a365 = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(30) }).accruedCents;
    const a360 = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: { ...P18, dayCount: 360 }, asOf: plus(30) }).accruedCents;
    expect(a360).toBe(1500);
    expect(a360).toBeGreaterThan(a365);
  });

  it('cuenta los días reales: 29 de febrero de un año bisiesto', () => {
    expect(accrueLateInterest({ dueDate: '2028-02-28', principal: 1000, policy: P18, asOf: '2028-03-01' }).daysAccrued).toBe(2);
    expect(accrueLateInterest({ dueDate: '2027-02-28', principal: 1000, policy: P18, asOf: '2027-03-01' }).daysAccrued).toBe(1);
  });

  it('D5 tope: el acumulado de la cuota no pasa de capPct % de su capital, y marca capped', () => {
    const capped = { ...P18, capPctOfPrincipal: 1 }; // 1 % de 1.000 = 10,00
    const r = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: capped, asOf: plus(365) });
    expect(r.accruedCents).toBe(1000);
    expect(r.capped).toBe(true);
    // Mucho después sigue igual.
    expect(accrueLateInterest({ dueDate: DUE, principal: 1000, policy: capped, asOf: plus(2000) }).accruedCents).toBe(1000);
  });

  it('el tope no recorta lo que todavía no lo alcanza', () => {
    const r = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: { ...P18, capPctOfPrincipal: 50 }, asOf: plus(30) });
    expect(r.accruedCents).toBe(1479);
    expect(r.capped).toBe(false);
  });

  it('P3: un cobro registrado DESPUÉS pero con fecha ANTERIOR no hace retroceder el devengo', () => {
    // Orden de registro: primero el del día 10, luego el del día 5 (se cobró antes pero se cargó tarde).
    const r = accrueLateInterest({
      dueDate: DUE,
      principal: 1000,
      policy: P18,
      asOf: plus(20),
      events: [
        { date: plus(10), principal: 400 },
        { date: plus(5), principal: 100 },
      ],
    });
    expect(r.tranches.map((t) => [t.days, t.baseCents])).toEqual([
      [10, 100_000],
      [10, 50_000], // el corte del día 5 se clampa al día 10: 0 días, y la base ya es 500
    ]);
    expect(r.tranches.every((t) => t.days > 0 && t.chargeCents > 0)).toBe(true);
  });

  it('un pago con fecha futura a asOf se corta en asOf (no devenga más allá de hoy)', () => {
    const r = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(10), events: [{ date: plus(50), principal: 400 }] });
    expect(r.daysAccrued).toBe(10);
  });

  it('D7 castigado: el devengo se congela en la fecha del castigo', () => {
    const r = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf: plus(300), stopAt: plus(30) });
    expect(r.accruedCents).toBe(1479);
    expect(r.daysAccrued).toBe(30);
  });

  it('una cuota sin capital o una tasa en cero no devengan nada (créditos sin desglose, política apagada)', () => {
    expect(accrueLateInterest({ dueDate: DUE, principal: 0, policy: P18, asOf: plus(30) }).accruedCents).toBe(0);
    expect(accrueLateInterest({ dueDate: DUE, principal: 1000, policy: { ...P18, annualRate: 0 }, asOf: plus(30) }).accruedCents).toBe(0);
  });

  it('una fecha inválida lanza: no se calcula un cargo a ciegas', () => {
    expect(() => accrueLateInterest({ dueDate: 'mañana', principal: 1000, policy: P18, asOf: plus(3) })).toThrow(/Fecha inválida/);
  });
});

describe('accrueLateInterest — propiedades', () => {
  /** Generador determinista (mulberry32): las pruebas de propiedad no pueden ser flaky. */
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('en 500 casos al azar: Σ tramos = devengado, nunca negativo, nunca sobre el tope, y no decrece al avanzar «hoy»', () => {
    const rand = rng(20261121);
    for (let n = 0; n < 500; n++) {
      const principal = Math.round((50 + rand() * 20_000) * 100) / 100;
      const policy: LateInterestParams = {
        annualRate: Math.round((1 + rand() * 60) * 100) / 100,
        dayCount: rand() < 0.5 ? 360 : 365,
        graceDays: Math.floor(rand() * 10),
        capPctOfPrincipal: rand() < 0.5 ? Math.round((1 + rand() * 40) * 100) / 100 : null,
      };
      const events = Array.from({ length: Math.floor(rand() * 5) }, () => ({ date: plus(Math.floor(rand() * 120) - 10), principal: Math.round(rand() * principal * 0.6 * 100) / 100 }));
      const capCents = policy.capPctOfPrincipal != null ? Math.round((principal * 100 * policy.capPctOfPrincipal) / 100) : Infinity;

      let previous = 0;
      for (let day = 0; day <= 160; day += 8) {
        const r = accrueLateInterest({ dueDate: DUE, principal, events, policy, asOf: plus(day) });
        expect(r.tranches.reduce((s, t) => s + t.chargeCents, 0)).toBe(r.accruedCents);
        expect(r.accruedCents).toBeGreaterThanOrEqual(previous);
        expect(r.accruedCents).toBeLessThanOrEqual(capCents + 1); // +1: el tope en centavos se redondea half-up
        expect(Number.isInteger(r.accruedCents)).toBe(true);
        for (const t of r.tranches) expect(t.days).toBeGreaterThan(0);
        previous = r.accruedCents;
      }
    }
  });

  it('partir el cálculo no inventa plata: con pagos de capital el devengo nunca supera al de no haber pagado', () => {
    const rand = rng(7);
    for (let n = 0; n < 200; n++) {
      const events = [{ date: plus(Math.floor(rand() * 40)), principal: Math.round(rand() * 800 * 100) / 100 }];
      const asOf = plus(60);
      const sin = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf }).accruedCents;
      const con = accrueLateInterest({ dueDate: DUE, principal: 1000, policy: P18, asOf, events }).accruedCents;
      expect(con).toBeLessThanOrEqual(sin + 1); // +1: el redondeo por tramo puede sumar un centavo
    }
  });
});
