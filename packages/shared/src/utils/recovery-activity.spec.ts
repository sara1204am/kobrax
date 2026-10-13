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

describe('validateRecoveryActivity — contexto de la gestión (F4/13 · E4)', () => {
  const visita = { type: 'VISIT', result: 'NOT_FOUND' } as const;

  it('🔴 todo es opcional: una gestión sin contexto sigue siendo válida (la cola puede traer gestiones anteriores)', () => {
    expect(v({ ...visita })).toBeNull();
    expect(v({ type: 'CALL', result: 'NO_ANSWER' })).toBeNull();
  });

  it('un motivo con formato de código es válido', () => {
    expect(v({ ...visita, reasonCode: 'LATE_INCOME' })).toBeNull();
    expect(v({ ...visita, reasonCode: 'RUBRO_2' })).toBeNull();
  });

  it('un motivo con formato inválido se rechaza (no se verifica contra el catálogo: la cuenta pudo editarlo)', () => {
    for (const reasonCode of ['', 'perdio el empleo', 'A'.repeat(41), 'con-guion']) {
      expect(v({ ...visita, reasonCode })).toBe('REASON_INVALID');
    }
    expect(v({ ...visita, reasonCode: 'CODIGO_QUE_YA_NO_EXISTE' })).toBeNull();
  });

  it('🔴 el motivo puede ir junto a una promesa: «le pagan tarde» y «prometió el viernes» son la misma historia', () => {
    expect(v({ type: 'CALL', result: 'PROMISE_TO_PAY', promise, reasonCode: 'LATE_INCOME', expectedIncomeDate: '2026-10-08' })).toBeNull();
  });

  it('una nota no lleva contexto', () => {
    expect(v({ type: 'NOTE', notes: 'x', reasonCode: 'FORGOT' })).toBe('CONTEXT_NOT_ALLOWED');
    expect(v({ type: 'NOTE', notes: 'x', payerParty: 'HOLDER' })).toBe('CONTEXT_NOT_ALLOWED');
    expect(v({ type: 'NOTE', notes: 'x', expectedIncomeDate: '2026-10-08' })).toBe('CONTEXT_NOT_ALLOWED');
  });

  it('la fecha en que espera cobrar necesita un motivo, ser una fecha real y no ser anterior a hoy', () => {
    expect(v({ ...visita, expectedIncomeDate: '2026-10-08' })).toBe('EXPECTED_INCOME_DATE_NEEDS_REASON');
    expect(v({ ...visita, reasonCode: 'LATE_INCOME', expectedIncomeDate: 'pronto' })).toBe('EXPECTED_INCOME_DATE_INVALID');
    expect(v({ ...visita, reasonCode: 'LATE_INCOME', expectedIncomeDate: '2026-02-31' })).toBe('EXPECTED_INCOME_DATE_INVALID');
    expect(v({ ...visita, reasonCode: 'LATE_INCOME', expectedIncomeDate: '2026-10-01' })).toBe('EXPECTED_INCOME_DATE_PAST');
    expect(v({ ...visita, reasonCode: 'LATE_INCOME', expectedIncomeDate: TODAY })).toBeNull();
    expect(v({ ...visita, reasonCode: 'LATE_INCOME', expectedIncomeDate: '2026-11-15' })).toBeNull();
  });

  it('quién responde y el origen son de un conjunto conocido', () => {
    for (const payerParty of ['HOLDER', 'GUARANTOR', 'CODEBTOR', 'BENEFICIARY', 'NOT_LOCATED']) expect(v({ ...visita, payerParty })).toBeNull();
    expect(v({ ...visita, payerParty: 'VECINO' })).toBe('PAYER_INVALID');
    for (const origin of ['MANUAL', 'DICTATION', 'IMPORT', 'SUGGESTION_ACCEPTED']) expect(v({ ...visita, origin })).toBeNull();
    expect(v({ ...visita, origin: 'ROBOT' })).toBe('ORIGIN_INVALID');
  });

  it('lo de siempre se valida primero: un resultado inválido gana sobre un contexto inválido', () => {
    expect(v({ type: 'CALL', result: 'NOT_FOUND', reasonCode: 'mal' })).toBe('RESULT_NOT_ALLOWED');
  });
});

describe('validateRecoveryActivity — plantilla elegida (F4/13 · E5)', () => {
  it('un mensaje puede llevar la plantilla que se eligió', () => {
    expect(v({ type: 'MESSAGE', result: 'CONTACTED', templateCode: 'LAST_NOTICE' })).toBeNull();
  });

  it('🔴 sin plantilla es lo de siempre', () => {
    expect(v({ type: 'MESSAGE', result: 'CONTACTED' })).toBeNull();
  });

  it('una llamada, una visita o una nota no llevan plantilla', () => {
    expect(v({ type: 'CALL', result: 'CONTACTED', templateCode: 'INITIAL' })).toBe('TEMPLATE_NOT_ALLOWED');
    expect(v({ type: 'VISIT', result: 'CONTACTED', templateCode: 'INITIAL' })).toBe('TEMPLATE_NOT_ALLOWED');
    expect(v({ type: 'NOTE', notes: 'x', templateCode: 'INITIAL' })).toBe('TEMPLATE_NOT_ALLOWED');
  });

  it('el código tiene formato de código', () => {
    expect(v({ type: 'MESSAGE', result: 'CONTACTED', templateCode: 'cobro inicial' })).toBe('TEMPLATE_INVALID');
    expect(v({ type: 'MESSAGE', result: 'CONTACTED', templateCode: '' })).toBe('TEMPLATE_INVALID');
  });
});
