import { VisitOutcome } from '@kobrax/shared';
import {
  buildDetails,
  canSubmitResult,
  initialResult,
  paymentOutcome,
  VISIT_VARIANTS,
  type ResultForm,
} from './visit-result';

const HOY = '2026-08-05';
const form = (over: Partial<ResultForm> = {}): ResultForm => ({ ...initialResult(HOY), ...over });

describe('VISIT_VARIANTS', () => {
  it('son las 6 del mockup y ninguna se quedó sin outcome', () => {
    expect(VISIT_VARIANTS).toHaveLength(6);
    for (const v of VISIT_VARIANTS) {
      expect(v.outcome).toBeTruthy();
      expect(v.cta).toBeTruthy();
    }
  });
});

describe('buildDetails', () => {
  it('no contesta manda el canal intentado', () => {
    expect(buildDetails('NO_ANSWER', form({ channel: 'DOOR' }))).toEqual({ channel: 'DOOR' });
  });

  it('la visita sin contacto es siempre en la puerta', () => {
    // Aunque el form traiga CALL de una variante anterior: el cobrador FUE al domicilio.
    expect(buildDetails('NO_CONTACT_VISIT', form({ channel: 'CALL', noticeLeft: true }))).toEqual({
      channel: 'DOOR',
      noticeLeft: true,
    });
  });

  it('la gestión especial manda su categoría', () => {
    expect(buildDetails('SPECIAL', form({ categoryCode: 'DECEASED' }))).toEqual({ categoryCode: 'DECEASED' });
  });

  it('las variantes sin campos propios no mandan nada', () => {
    expect(buildDetails('PAID', form({ channel: 'DOOR', categoryCode: 'X' }))).toEqual({});
    expect(buildDetails('WRONG_ADDRESS', form({ categoryCode: 'X' }))).toEqual({});
  });
});

describe('canSubmitResult', () => {
  it('cobrado exige monto y no deja pasarse del saldo', () => {
    expect(canSubmitResult('PAID', form({ amount: '0' }), 500)).toBe(false);
    expect(canSubmitResult('PAID', form({ amount: '500' }), 500)).toBe(true);
    expect(canSubmitResult('PAID', form({ amount: '500.01' }), 500)).toBe(false);
    // Sin saldo conocido no se inventa un techo.
    expect(canSubmitResult('PAID', form({ amount: '99999' }), undefined)).toBe(true);
  });

  it('la promesa exige monto y fecha', () => {
    expect(canSubmitResult('PROMISE', form({ amount: '100' }))).toBe(true);
    expect(canSubmitResult('PROMISE', form({ amount: '' }))).toBe(false);
    expect(canSubmitResult('PROMISE', form({ amount: '100', promiseDate: 'mañana' }))).toBe(false);
  });

  it('la gestión especial exige la categoría — la regla la pone el validador compartido', () => {
    expect(canSubmitResult('SPECIAL', form())).toBe(false);
    expect(canSubmitResult('SPECIAL', form({ categoryCode: 'DECEASED' }))).toBe(true);
  });

  it('la dirección incorrecta exige explicar qué pasó', () => {
    expect(canSubmitResult('WRONG_ADDRESS', form())).toBe(false);
    expect(canSubmitResult('WRONG_ADDRESS', form({ notes: 'El edificio ya no existe' }))).toBe(true);
  });

  it('no contesta y visita sin contacto se pueden guardar sin escribir nada', () => {
    expect(canSubmitResult('NO_ANSWER', form())).toBe(true);
    expect(canSubmitResult('NO_CONTACT_VISIT', form())).toBe(true);
  });
});

describe('paymentOutcome', () => {
  it('cubrir el saldo es PAID; menos que eso es parcial', () => {
    expect(paymentOutcome(500, 500)).toBe(VisitOutcome.PAID);
    expect(paymentOutcome(600, 500)).toBe(VisitOutcome.PAID);
    expect(paymentOutcome(100, 500)).toBe(VisitOutcome.PARTIAL_PAYMENT);
  });

  it('sin saldo conocido no marca un parcial que no puede probar', () => {
    expect(paymentOutcome(100, undefined)).toBe(VisitOutcome.PAID);
  });
});
