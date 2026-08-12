import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS } from '@kobrax/shared';
import { defaultPeriod, isPaymentMethod, paymentQuery, totalOf } from './payments';

const TODAY = new Date('2026-08-12T16:00:00.000Z');

describe('paymentQuery', () => {
  it('🔴 el `to` viaja con el final del día, no con la fecha pelada', () => {
    // `paymentDate` es un timestamp: con la fecha pelada el límite queda en medianoche y los pagos
    // de ese día quedan afuera. Es el mismo defecto que en W6 hacía dar cero al «recaudado».
    expect(paymentQuery({ from: '2026-08-01', to: '2026-08-12' }, 20, TODAY).get('to')).toBe(
      '2026-08-12T23:59:59.999Z',
    );
  });

  it('sin período, el mes corriente', () => {
    const query = paymentQuery({}, 20, TODAY);
    expect(query.get('from')).toBe('2026-08-01');
    expect(query.get('to')).toBe('2026-08-12T23:59:59.999Z');
  });

  it('una fecha inventada en la URL cae al período por defecto, no rompe ni viaja', () => {
    const query = paymentQuery({ from: 'ayer', to: '12/08/2026' }, 20, TODAY);
    expect(query.get('from')).toBe('2026-08-01');
    expect(query.get('to')).toBe('2026-08-12T23:59:59.999Z');
  });

  it('pasa el crédito y el caso cuando están, y no los manda vacíos', () => {
    expect(paymentQuery({ creditId: 'cr1' }, 20, TODAY).get('creditId')).toBe('cr1');
    expect(paymentQuery({}, 20, TODAY).has('creditId')).toBe(false);
  });

  it('una página inválida cae en la primera', () => {
    expect(paymentQuery({ page: '-2' }, 20, TODAY).get('page')).toBe('1');
  });
});

describe('defaultPeriod', () => {
  it('arranca el 1° del mes, en UTC', () => {
    expect(defaultPeriod(new Date('2026-01-31T23:00:00.000Z'))).toEqual({ from: '2026-01-01', to: '2026-01-31' });
  });
});

describe('totalOf', () => {
  it('suma sin arrastrar la basura del punto flotante', () => {
    const total = totalOf([{ amount: 0.1 }, { amount: 0.2 }] as never);
    expect(total).toBe(0.3);
  });

  it('sin pagos, cero', () => {
    expect(totalOf([])).toBe(0);
  });
});

describe('isPaymentMethod', () => {
  it('acepta los que la API espera, en MAYÚSCULA', () => {
    // El delta C7: en minúscula el pago rebotaba. Arreglado en shared en W7-T0.
    expect(PAYMENT_METHODS).toEqual(['CASH', 'TRANSFER', 'QR', 'CARD', 'MOBILE_PAYMENT']);
    expect(isPaymentMethod('CASH')).toBe(true);
    expect(isPaymentMethod('cash')).toBe(false);
    expect(isPaymentMethod('BITCOIN')).toBe(false);
  });
});
