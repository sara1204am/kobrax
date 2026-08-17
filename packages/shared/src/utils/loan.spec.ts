import { describe, expect, it } from 'vitest';
import { InterestBase, PaymentFrequency, PortfolioStatus, CreditOrigin } from '../enums/credit.enum.js';
import {
  addPeriods,
  arrearsFromDueDate,
  arrearsSourceOf,
  creditView,
  manualArrears,
  moraSinceFromDays,
  portfolioStatus,
  quoteFromInstallment,
  quoteLoan,
  readCreditMetadata,
} from './loan.js';
import { searchTerms } from './client-form.js';

const d = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

/**
 * Una mora, tres orígenes, **un dueño cada uno**. Esta es la regla que sostiene todo el módulo:
 * si el trabajo diario pudiera decidir la mora manual o la importada, aparecería el ciclo de
 * «lo puse al día y volvió a mora a la mañana».
 */
/**
 * 🔴 El caso que la motivó: **«Teresa Mama» tiene que encontrar a «Teresa Mamani Padilla»**. Con la
 * frase entera no la encuentra nunca — el espacio cae justo entre el nombre y el apellido.
 */
describe('searchTerms — buscar como se escribe un nombre', () => {
  it('parte la búsqueda en palabras', () => {
    expect(searchTerms('Teresa Mama')).toEqual(['Teresa', 'Mama']);
  });

  it('aguanta los espacios de más y los bordes', () => {
    expect(searchTerms('  Teresa   Mama  ')).toEqual(['Teresa', 'Mama']);
    expect(searchTerms('')).toEqual([]);
    expect(searchTerms(undefined)).toEqual([]);
    expect(searchTerms('   ')).toEqual([]);
  });

  // Cada palabra suma un OR de tres ILIKE: una frase pegada armaría un WHERE que no termina.
  it('corta en cinco palabras', () => {
    expect(searchTerms('a b c d e f g')).toHaveLength(5);
  });
});

describe('arrearsSourceOf — de quién es la mora', () => {
  const meta = (over: Record<string, unknown> = {}) => readCreditMetadata({ origin: CreditOrigin.MANUAL, ...over });

  it('sin marca a mano, la calcula el sistema', () => {
    expect(arrearsSourceOf(meta())).toBe('CALCULATED');
  });

  it('con `moraSince`, el dueño es quien la marcó', () => {
    expect(arrearsSourceOf(meta({ moraSince: '2026-08-01' }))).toBe('MANUAL');
  });

  it('el importado gana sobre la marca a mano: su archivo manda hasta la próxima carga', () => {
    expect(arrearsSourceOf(meta({ origin: CreditOrigin.IMPORT, moraSince: '2026-08-01' }))).toBe('IMPORTED');
    expect(arrearsSourceOf(meta({ origin: CreditOrigin.API }))).toBe('IMPORTED');
  });

  // `quick_batch` es carga rápida del propio cobrador: dato suyo, se calcula como cualquier otro.
  it('la carga rápida por lote NO es importada', () => {
    expect(arrearsSourceOf(meta({ origin: CreditOrigin.QUICK_BATCH }))).toBe('CALCULATED');
  });
});

/**
 * 🔴 Se guarda la FECHA, no los días. Guardando `15` el número queda congelado y para envejecerlo el
 * job tendría que escribir encima de la mora manual — rompiendo la regla de un dueño por origen.
 */
describe('manualArrears — la mora marcada a mano envejece sola', () => {
  it('cuenta los días desde que alguien la marcó', () => {
    expect(manualArrears('2026-08-01', 900, d('2026-08-01'))).toBe(0);
    expect(manualArrears('2026-08-01', 900, d('2026-08-11'))).toBe(10);
    // Diez días después, sin que nadie haya escrito nada.
    expect(manualArrears('2026-08-01', 900, d('2026-08-21'))).toBe(20);
  });

  it('sin saldo no hay mora, aunque la marca siga puesta', () => {
    expect(manualArrears('2026-08-01', 0, d('2026-08-21'))).toBe(0);
  });

  it('sin marca no hay mora manual', () => {
    expect(manualArrears(undefined, 900, d('2026-08-21'))).toBe(0);
  });

  it('«lleva 15 días» se guarda como una fecha, y vuelve a leerse como 15', () => {
    const since = moraSinceFromDays(15, d('2026-08-17'));
    expect(since).toBe('2026-08-02');
    expect(manualArrears(since, 900, d('2026-08-17'))).toBe(15);
  });

  it('marcar sin decir días arranca en cero y suma uno mañana', () => {
    const since = moraSinceFromDays(0, d('2026-08-17'));
    expect(manualArrears(since, 900, d('2026-08-17'))).toBe(0);
    expect(manualArrears(since, 900, d('2026-08-18'))).toBe(1);
  });
});

describe('quoteLoan — las dos bases del §4.2', () => {
  it('el ejemplo literal del PDF: 1.000 al 10% por período en 5 cuotas → 300 / 1.500 / 500', () => {
    expect(quoteLoan({ principal: 1000, interestPercent: 10, installments: 5 })).toEqual({
      installment: 300,
      total: 1500,
      profit: 500,
    });
  });

  it('base "% total": 1.000 al 10% total en 5 cuotas → total 1.100, cuota 220', () => {
    expect(quoteLoan({ principal: 1000, interestPercent: 10, installments: 5, base: InterestBase.TOTAL })).toEqual({
      installment: 220,
      total: 1100,
      profit: 100,
    });
  });

  it('interés 0 devuelve capital/n sin ganancia', () => {
    expect(quoteLoan({ principal: 900, interestPercent: 0, installments: 3 })).toEqual({
      installment: 300,
      total: 900,
      profit: 0,
    });
  });

  it('la cuota redondeada a mano recalcula el total (§5.2, es editable)', () => {
    // 1.000 al 7% por período en 3 → 270,00 exacto; el cobrador la sube a 275 y el total la sigue.
    expect(quoteFromInstallment(1000, 275, 3)).toEqual({ installment: 275, total: 825, profit: -175 });
  });
});

describe('addPeriods', () => {
  it('avanza el paso de cada frecuencia', () => {
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.DAILY)).toEqual(d('2026-07-14'));
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.WEEKLY)).toEqual(d('2026-07-20'));
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.BIWEEKLY)).toEqual(d('2026-07-27'));
    expect(addPeriods(d('2026-07-13'), 1, PaymentFrequency.MONTHLY)).toEqual(d('2026-08-13'));
  });

  it('mensual sobre fin de mes no se pasa al mes siguiente', () => {
    expect(addPeriods(d('2026-01-31'), 1, PaymentFrequency.MONTHLY).getUTCMonth()).toBe(2); // marzo (JS clamp)
  });
});

describe('arrearsFromDueDate — mora sin cronograma (§6)', () => {
  it('cuenta los días desde la fecha vencida', () => {
    expect(arrearsFromDueDate('2026-07-01', 500, d('2026-07-13'))).toBe(12);
  });

  it('saldo 0 ⇒ sin mora, aunque la fecha esté vencida', () => {
    expect(arrearsFromDueDate('2026-07-01', 0, d('2026-07-13'))).toBe(0);
  });

  it('fecha futura ⇒ 0, nunca negativo', () => {
    expect(arrearsFromDueDate('2026-08-01', 500, d('2026-07-13'))).toBe(0);
  });

  it('sin fecha ⇒ 0 (no inventa mora)', () => {
    expect(arrearsFromDueDate(undefined, 500, d('2026-07-13'))).toBe(0);
  });
});

describe('portfolioStatus — los 5 estados derivados del §5.3', () => {
  const base = { outstandingBalance: 500, daysPastDue: 0, nextDueDate: '2026-08-01' };

  it('PAGADO gana sobre todo: saldo 0', () => {
    expect(portfolioStatus({ ...base, outstandingBalance: 0, daysPastDue: 30 }, d('2026-07-13'))).toBe(
      PortfolioStatus.PAID,
    );
  });

  it('PROMESA tapa la mora: hay compromiso vigente', () => {
    expect(portfolioStatus({ ...base, daysPastDue: 12, hasActivePromise: true }, d('2026-07-13'))).toBe(
      PortfolioStatus.PROMISE,
    );
  });

  it('EN MORA con daysPastDue > 0', () => {
    expect(portfolioStatus({ ...base, daysPastDue: 12 }, d('2026-07-13'))).toBe(PortfolioStatus.OVERDUE);
  });

  it('POR VENCER dentro del umbral de 3 días', () => {
    expect(portfolioStatus({ ...base, nextDueDate: '2026-07-15' }, d('2026-07-13'))).toBe(PortfolioStatus.DUE_SOON);
  });

  it('AL DÍA más allá del umbral', () => {
    expect(portfolioStatus(base, d('2026-07-13'))).toBe(PortfolioStatus.CURRENT);
  });

  it('fecha ya pasada pero mora aún sin recalcular ⇒ EN MORA igual', () => {
    expect(portfolioStatus({ ...base, nextDueDate: '2026-07-10' }, d('2026-07-13'))).toBe(PortfolioStatus.OVERDUE);
  });
});

describe('creditView — cuota y próxima fecha, vengan de donde vengan', () => {
  it('sin cronograma: las lee del metadata', () => {
    const v = creditView({
      metadata: { frequency: 'WEEKLY', origin: 'import', installmentAmount: 300, nextDueDate: '2026-07-20' },
    });
    expect(v).toMatchObject({
      hasSchedule: false,
      locked: true, // importado ⇒ candado
      installmentAmount: 300,
      nextDueDate: '2026-07-20',
      frequency: PaymentFrequency.WEEKLY,
    });
  });

  it('con cronograma: las deriva de la cuota impaga más antigua', () => {
    const v = creditView({
      metadata: { origin: 'manual' },
      installments: [
        { dueDate: d('2026-06-01'), amount: 250, status: 'PAID' },
        { dueDate: d('2026-07-01'), amount: 250, status: 'PENDING' },
        { dueDate: d('2026-08-01'), amount: 250, status: 'PENDING' },
      ],
    });
    expect(v).toMatchObject({ hasSchedule: true, locked: false, installmentAmount: 250, nextDueDate: '2026-07-01' });
  });

  it('solo el dato de un core ajeno lleva candado (§3): import y api sí, manual y quick_batch no', () => {
    expect(creditView({ metadata: { origin: 'manual' } }).locked).toBe(false);
    expect(creditView({ metadata: { origin: 'quick_batch' } }).locked).toBe(false); // lote propio del cobrador
    expect(creditView({ metadata: { origin: 'import' } }).locked).toBe(true);
    expect(creditView({ metadata: { origin: 'api' } }).locked).toBe(true);
  });
});

describe('readCreditMetadata', () => {
  it('un metadata vacío no rompe: mensual y manual por defecto', () => {
    expect(readCreditMetadata({})).toEqual({
      frequency: PaymentFrequency.MONTHLY,
      origin: CreditOrigin.MANUAL,
      installmentAmount: undefined,
      nextDueDate: undefined,
      externalRef: undefined,
      notes: undefined,
    });
  });

  it('descarta valores basura en vez de propagarlos', () => {
    const m = readCreditMetadata({ frequency: 'ANUAL', origin: 42, installmentAmount: '300' });
    expect(m.frequency).toBe(PaymentFrequency.MONTHLY);
    expect(m.origin).toBe(CreditOrigin.MANUAL);
    expect(m.installmentAmount).toBeUndefined();
  });
});
