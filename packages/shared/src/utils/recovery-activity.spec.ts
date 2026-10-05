import { describe, expect, it } from 'vitest';
import { RECOVERY_RESULTS, RECOVERY_RESULTS_BY_TYPE, validateRecoveryActivity, type RecoveryActivityInput } from './recovery-activity.js';

const TODAY = '2026-10-02';
const promise = { amount: 500, promiseDate: '2026-10-09', paymentMethodCode: 'CASH' };
const v = (i: RecoveryActivityInput) => validateRecoveryActivity(i, TODAY);

describe('validateRecoveryActivity — qué se puede registrar', () => {
  it('una visita con resultado es válida', () => expect(v({ type: 'VISIT', result: 'NOT_FOUND', notes: 'Se dejó aviso con un familiar' })).toBeNull());

  it('un tipo que no se registra a mano se rechaza', () => {
    expect(v({ type: 'PAYMENT', result: 'CONTACTED' })).toBe('TYPE_INVALID');
    expect(v({ type: 'ASSIGNMENT' })).toBe('TYPE_INVALID');
  });

  it('🔴 una llamada, visita o mensaje exige resultado', () => {
    for (const type of ['CALL', 'VISIT', 'MESSAGE']) expect(v({ type, notes: 'x' })).toBe('RESULT_REQUIRED');
  });

  it('el resultado tiene que corresponder al tipo: «no lo encontró» es de una visita, «número equivocado» de una llamada', () => {
    expect(v({ type: 'CALL', result: 'NOT_FOUND' })).toBe('RESULT_NOT_ALLOWED');
    expect(v({ type: 'MESSAGE', result: 'WRONG_ADDRESS' })).toBe('RESULT_NOT_ALLOWED');
    expect(v({ type: 'VISIT', result: 'WRONG_NUMBER' })).toBe('RESULT_NOT_ALLOWED');
    expect(v({ type: 'CALL', result: 'WRONG_NUMBER' })).toBeNull();
    expect(v({ type: 'VISIT', result: 'WRONG_ADDRESS' })).toBeNull();
  });

  it('un resultado inventado se rechaza (antes era texto libre)', () => {
    expect(v({ type: 'CALL', result: 'ok' })).toBe('RESULT_NOT_ALLOWED');
  });

  it('todo resultado que se ofrece existe en la lista y alguien lo puede usar', () => {
    const offered = new Set(Object.values(RECOVERY_RESULTS_BY_TYPE).flat());
    for (const r of RECOVERY_RESULTS) expect(offered.has(r)).toBe(true);
  });
});

describe('validateRecoveryActivity — notas', () => {
  it('una nota sólo lleva texto, y el texto es obligatorio', () => {
    expect(v({ type: 'NOTE', notes: 'Llamar el viernes' })).toBeNull();
    expect(v({ type: 'NOTE', notes: '   ' })).toBe('NOTES_REQUIRED');
    expect(v({ type: 'NOTE' })).toBe('NOTES_REQUIRED');
  });

  it('una nota no lleva resultado ni promesa', () => {
    expect(v({ type: 'NOTE', notes: 'x', result: 'CONTACTED' })).toBe('RESULT_NOT_ALLOWED');
    expect(v({ type: 'NOTE', notes: 'x', promise })).toBe('PROMISE_NOT_ALLOWED');
  });

  it('el largo máximo vale para todos los tipos', () => {
    expect(v({ type: 'CALL', result: 'CONTACTED', notes: 'x'.repeat(1000) })).toBeNull();
    expect(v({ type: 'CALL', result: 'CONTACTED', notes: 'x'.repeat(1001) })).toBe('NOTES_TOO_LONG');
  });
});

describe('validateRecoveryActivity — la promesa de pago', () => {
  it('🔴 «promesa de pago» exige los datos de la promesa', () => {
    expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY' })).toBe('PROMISE_REQUIRED');
  });

  it('🔴 y los datos de una promesa exigen ese resultado: no pueden contradecirse', () => {
    expect(v({ type: 'CALL', result: 'NO_ANSWER', promise })).toBe('PROMISE_NOT_ALLOWED');
    expect(v({ type: 'VISIT', result: 'PROMISE_TO_PAY', promise })).toBeNull();
  });

  it('el monto tiene que ser un número positivo', () => {
    for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...promise, amount } })).toBe('PROMISE_AMOUNT_INVALID');
    }
  });

  it('la fecha prometida no puede ser pasada, pero hoy vale', () => {
    expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...promise, promiseDate: '2026-10-01' } })).toBe('PROMISE_DATE_PAST');
    expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...promise, promiseDate: TODAY } })).toBeNull();
  });

  it('una fecha mal escrita se rechaza', () => {
    for (const promiseDate of ['mañana', '2026-13-45', '10/10/2026', '']) {
      expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...promise, promiseDate } })).toBe('PROMISE_DATE_INVALID');
    }
  });

  it('el medio de pago es obligatorio; el banco no', () => {
    expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...promise, paymentMethodCode: '  ' } })).toBe('PROMISE_METHOD_REQUIRED');
    expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY', promise: { ...promise, bankCode: 'BNB' } })).toBeNull();
  });
});
