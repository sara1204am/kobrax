import { describe, expect, it } from 'vitest';
import { PortfolioStatus } from '@kobrax/shared';
import { matchesText, rowStatus } from './portfolio';

describe('rowStatus', () => {
  it('con saldo cero es PAGADO, aunque arrastre mora vieja', () => {
    expect(rowStatus({ totalDebt: 0, maxDaysPastDue: 30 })).toBe(PortfolioStatus.PAID);
  });

  it('con mora es EN MORA', () => {
    expect(rowStatus({ totalDebt: 1500, maxDaysPastDue: 8 })).toBe(PortfolioStatus.OVERDUE);
  });

  it('con deuda y sin mora es AL DÍA', () => {
    expect(rowStatus({ totalDebt: 1500, maxDaysPastDue: 0 })).toBe(PortfolioStatus.CURRENT);
  });

  /**
   * La lista no tiene el próximo vencimiento —no es una columna, sale de `creditView()`— así que
   * POR VENCER no puede aparecer acá. Está fijado a propósito: si un día la lista lo mostrara sin
   * traer la fecha, sería un estado inventado.
   */
  it('nunca dice POR VENCER: la lista no conoce el próximo vencimiento', () => {
    for (const debt of [0, 0.004, 1, 99999]) {
      for (const dpd of [0, 1, 90]) {
        expect(rowStatus({ totalDebt: debt, maxDaysPastDue: dpd })).not.toBe(PortfolioStatus.DUE_SOON);
      }
    }
  });

  // El saldo se compara contra un épsilon: un centavo de redondeo no es una deuda.
  it('un resto de medio centavo cuenta como pagado', () => {
    expect(rowStatus({ totalDebt: 0.004, maxDaysPastDue: 0 })).toBe(PortfolioStatus.PAID);
  });
});

describe('matchesText', () => {
  it('ignora acentos y mayúsculas', () => {
    expect(matchesText('Martínez', 'MARTINEZ')).toBe(true);
    expect(matchesText('MARTINEZ', 'martínez')).toBe(true);
  });

  it('busca por pedazo, no sólo por el principio', () => {
    expect(matchesText('ana@kobrax.test', 'kobrax')).toBe(true);
  });

  it('sin búsqueda pasa todo', () => {
    expect(matchesText('lo que sea', '   ')).toBe(true);
  });

  it('lo que no está, no está', () => {
    expect(matchesText('Ana Ruiz', 'pérez')).toBe(false);
  });
});
