import { describe, expect, it } from 'vitest';
import { VisitOutcome } from '../enums/visit-outcome.enum.js';
import {
  VARIANT_OUTCOME,
  VISIT_VARIANT_KEYS,
  buildVisitDetails,
  canSubmitVisitResult,
  initialVisitResult,
  paymentCap,
  paymentOutcome,
} from './visit-result.js';

const form = (over: Partial<ReturnType<typeof initialVisitResult>> = {}) => ({ ...initialVisitResult('2026-10-08'), ...over });

describe('las 6 variantes del resultado de una visita', () => {
  it('son seis, en este orden, y cada una guarda su resultado', () => {
    expect([...VISIT_VARIANT_KEYS]).toEqual(['PAID', 'PROMISE', 'NO_ANSWER', 'NO_CONTACT_VISIT', 'WRONG_ADDRESS', 'SPECIAL']);
    expect(VARIANT_OUTCOME.PAID).toBe(VisitOutcome.PAID);
    expect(VARIANT_OUTCOME.PROMISE).toBe(VisitOutcome.PROMISE_TO_PAY);
    // «No contesta» y «visita sin contacto» son el mismo resultado; las distingue el canal.
    expect(VARIANT_OUTCOME.NO_ANSWER).toBe(VisitOutcome.NO_CONTACT);
    expect(VARIANT_OUTCOME.NO_CONTACT_VISIT).toBe(VisitOutcome.NO_CONTACT);
  });

  it('cada una manda solo sus propios campos', () => {
    expect(buildVisitDetails('NO_ANSWER', form({ channel: 'CALL' }))).toEqual({ channel: 'CALL' });
    expect(buildVisitDetails('NO_CONTACT_VISIT', form({ noticeLeft: true }))).toEqual({ channel: 'DOOR', noticeLeft: true });
    expect(buildVisitDetails('SPECIAL', form({ categoryCode: 'DECEASED' }))).toEqual({ categoryCode: 'DECEASED' });
    expect(buildVisitDetails('PAID', form({ amount: '100' }))).toEqual({});
    expect(buildVisitDetails('WRONG_ADDRESS', form({ notes: 'x' }))).toEqual({});
  });
});

describe('canSubmitVisitResult', () => {
  it('cobrado: monto mayor a cero y sin pasar el saldo', () => {
    expect(canSubmitVisitResult('PAID', form({ amount: '' }))).toBe(false);
    expect(canSubmitVisitResult('PAID', form({ amount: '0' }))).toBe(false);
    expect(canSubmitVisitResult('PAID', form({ amount: '50' }), 100)).toBe(true);
    expect(canSubmitVisitResult('PAID', form({ amount: '100' }), 100)).toBe(true);
    expect(canSubmitVisitResult('PAID', form({ amount: '100.01' }), 100)).toBe(false);
    // Sin tope (crédito externo): cualquier monto positivo.
    expect(canSubmitVisitResult('PAID', form({ amount: '999999' }))).toBe(true);
  });

  it('promesa: monto y fecha con formato de día', () => {
    expect(canSubmitVisitResult('PROMISE', form({ amount: '80' }))).toBe(true);
    expect(canSubmitVisitResult('PROMISE', form({ amount: '0' }))).toBe(false);
    expect(canSubmitVisitResult('PROMISE', form({ amount: '80', promiseDate: '8/10/2026' }))).toBe(false);
  });

  it('dirección incorrecta exige explicar qué pasó', () => {
    expect(canSubmitVisitResult('WRONG_ADDRESS', form({ notes: '   ' }))).toBe(false);
    expect(canSubmitVisitResult('WRONG_ADDRESS', form({ notes: 'La calle no existe' }))).toBe(true);
  });

  it('gestión especial exige la categoría; no contesta y visita sin contacto siempre se pueden guardar', () => {
    expect(canSubmitVisitResult('SPECIAL', form({ categoryCode: '' }))).toBe(false);
    expect(canSubmitVisitResult('SPECIAL', form({ categoryCode: 'ILLNESS' }))).toBe(true);
    expect(canSubmitVisitResult('NO_ANSWER', form())).toBe(true);
    expect(canSubmitVisitResult('NO_CONTACT_VISIT', form())).toBe(true);
  });
});

describe('cobro: tope y resultado', () => {
  it('🔴 un crédito de fuente externa no tiene tope', () => {
    expect(paymentCap({ overdueAmount: 500 })).toBe(500);
    expect(paymentCap({ overdueAmount: 500, externalSource: 'PSF' })).toBeUndefined();
    expect(paymentCap(null)).toBeUndefined();
    expect(paymentCap(undefined)).toBeUndefined();
  });

  it('cubre el saldo = pagado; si no, parcial; sin saldo conocido, pagado', () => {
    expect(paymentOutcome(100, 100)).toBe(VisitOutcome.PAID);
    expect(paymentOutcome(60, 100)).toBe(VisitOutcome.PARTIAL_PAYMENT);
    expect(paymentOutcome(99.996, 100)).toBe(VisitOutcome.PAID);
    expect(paymentOutcome(10, undefined)).toBe(VisitOutcome.PAID);
  });
});
