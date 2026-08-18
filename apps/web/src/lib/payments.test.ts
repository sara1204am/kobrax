import { describe, expect, it } from 'vitest';
import { PAYMENT_METHODS } from '@kobrax/shared';
import {
  DEFAULT_PAGE_SIZE,
  defaultPeriod,
  hasPaymentFilters,
  isUuid,
  paymentLimit,
  paymentQuery,
  totalOf,
} from './payments';

const TODAY = new Date('2026-08-12T16:00:00.000Z');
const CREDIT = '3f2b9c10-1a4d-4b7e-9c8f-0a1b2c3d4e5f';

describe('paymentQuery', () => {
  it('🔴 el `to` viaja con el final del día, no con la fecha pelada', () => {
    // `paymentDate` es un timestamp: con la fecha pelada el límite queda en medianoche y los pagos
    // de ese día quedan afuera. Es el mismo defecto que en W6 hacía dar cero al «recaudado».
    expect(paymentQuery({ from: '2026-08-01', to: '2026-08-12' }, TODAY).get('to')).toBe(
      '2026-08-12T23:59:59.999Z',
    );
  });

  it('sin período, el mes corriente', () => {
    const query = paymentQuery({}, TODAY);
    expect(query.get('from')).toBe('2026-08-01');
    expect(query.get('to')).toBe('2026-08-12T23:59:59.999Z');
  });

  it('una fecha inventada en la URL cae al período por defecto, no rompe ni viaja', () => {
    const query = paymentQuery({ from: 'ayer', to: '12/08/2026' }, TODAY);
    expect(query.get('from')).toBe('2026-08-01');
    expect(query.get('to')).toBe('2026-08-12T23:59:59.999Z');
  });

  it('pasa el crédito y el caso cuando están, y no los manda vacíos', () => {
    expect(paymentQuery({ creditId: CREDIT }, TODAY).get('creditId')).toBe(CREDIT);
    expect(paymentQuery({}, TODAY).has('creditId')).toBe(false);
  });

  it('🔴 un crédito o un caso que no es uuid NO viaja', () => {
    // El DTO los valida: un valor de más en la URL sería un 400 que deja el ledger entero vacío.
    expect(paymentQuery({ creditId: 'cr1' }, TODAY).has('creditId')).toBe(false);
    expect(paymentQuery({ caseId: '../../users' }, TODAY).has('caseId')).toBe(false);
  });

  it('el tamaño de página sale de la URL, y uno inventado cae en el default', () => {
    expect(paymentQuery({ pageSize: '50' }, TODAY).get('limit')).toBe('50');
    // La API valida `limit ≤ 100`: pedir más es un 400, no una lista más larga.
    expect(paymentLimit({ pageSize: '500' })).toBe(DEFAULT_PAGE_SIZE);
    expect(paymentQuery({}, TODAY).get('limit')).toBe(String(DEFAULT_PAGE_SIZE));
  });

  it('una página inválida cae en la primera', () => {
    expect(paymentQuery({ page: '-2' }, TODAY).get('page')).toBe('1');
  });
});

describe('hasPaymentFilters', () => {
  it('🔴 el período por defecto NO cuenta como filtro', () => {
    // Si contara, un mes sin cobranza diría «no hay pagos con esos filtros» en vez de «no se cobró
    // nada este mes», que es lo que de verdad pasó.
    expect(hasPaymentFilters({})).toBe(false);
    expect(hasPaymentFilters({ from: '2026-08-01' })).toBe(true);
    expect(hasPaymentFilters({ creditId: CREDIT })).toBe(true);
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

describe('PAYMENT_METHODS', () => {
  it('viajan en MAYÚSCULA, que es lo que la API espera', () => {
    // El delta C7: en minúscula el pago rebotaba. Arreglado en shared en W7-T0, y los dos selects
    // de la etapa pintan esta lista tal cual.
    expect(PAYMENT_METHODS).toEqual(['CASH', 'TRANSFER', 'QR', 'CARD', 'MOBILE_PAYMENT']);
  });
});

describe('isUuid', () => {
  it('🔴 corta el id inventado antes de que entre a la ruta de la API', () => {
    // Sin esto, `creditId=../../users` hacía que el BFF pidiera `/users` con el Bearer de quien
    // mira: la normalización de la URL se come el `..` antes de que la API vea nada.
    expect(isUuid('3f2b9c10-1a4d-4b7e-9c8f-0a1b2c3d4e5f')).toBe(true);
    expect(isUuid('../../users')).toBe(false);
    expect(isUuid('solicitudes')).toBe(false);
    expect(isUuid('')).toBe(false);
  });
});
