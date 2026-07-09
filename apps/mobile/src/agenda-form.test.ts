import { AgendaItemType, AgendaTimeSlot, ScheduleTimeMode } from '@kobrax/shared';
import { buildPayload, canSubmit, formReducer, initialForm, type FormState } from './agenda-form';

const CONTACT = '11111111-1111-4111-8111-111111111111';
const CASE = '22222222-2222-4222-8222-222222222222';
const CREDIT = '33333333-3333-4333-8333-333333333333';

/** Formulario de llamada listo para guardar. */
function readyCall(): FormState {
  let s = initialForm('2026-07-10');
  s = formReducer(s, { t: 'client', clientId: 'cl1' });
  s = formReducer(s, { t: 'credit', caseId: CASE, creditId: CREDIT });
  s = formReducer(s, { t: 'details', patch: { contactId: CONTACT } });
  return formReducer(s, { t: 'time', value: '15:30' });
}

describe('canSubmit', () => {
  it('exige cliente, crédito, programación y details válido para el tipo', () => {
    expect(canSubmit(readyCall())).toBe(true);
    expect(canSubmit(initialForm('2026-07-10'))).toBe(false);
  });

  it('sin crédito elegido no se guarda, aunque el resto esté completo', () => {
    const s = { ...readyCall(), caseId: null, creditId: null };
    expect(canSubmit(s)).toBe(false);
  });

  it('FIXED sin hora válida no habilita; LAPSE no necesita hora', () => {
    const noTime = formReducer(readyCall(), { t: 'time', value: '' });
    expect(canSubmit(noTime)).toBe(false);
    expect(canSubmit(formReducer(noTime, { t: 'timeMode', value: ScheduleTimeMode.LAPSE }))).toBe(true);
    expect(canSubmit(formReducer(readyCall(), { t: 'time', value: '25:00' }))).toBe(false);
  });

  it('cada tipo pide lo suyo: promesa necesita monto, fecha y medio de pago', () => {
    const base = formReducer(readyCall(), { t: 'type', value: AgendaItemType.PROMISE_TO_PAY });
    expect(canSubmit(base)).toBe(false);
    const full = formReducer(base, {
      t: 'details',
      patch: { amount: 250.5, promiseDate: '2026-08-01', paymentMethodCode: 'CASH' },
    });
    expect(canSubmit(full)).toBe(true);
  });

  it('un medio de pago que exige banco bloquea el guardado hasta elegirlo', () => {
    const promise = formReducer(formReducer(readyCall(), { t: 'type', value: AgendaItemType.PROMISE_TO_PAY }), {
      t: 'details',
      patch: { amount: 100, promiseDate: '2026-08-01', paymentMethodCode: 'TRANSFER' },
    });
    expect(canSubmit(promise, true)).toBe(false); // requiresBank y sin banco → el server lo rechazaría
    expect(canSubmit(promise, false)).toBe(true);
    expect(canSubmit(formReducer(promise, { t: 'details', patch: { bankCode: 'BNB' } }), true)).toBe(true);
  });
});

describe('formReducer', () => {
  it('cambiar de tipo limpia details pero conserva cliente, crédito, fecha y hora', () => {
    const next = formReducer(readyCall(), { t: 'type', value: AgendaItemType.VISIT });
    expect(next.details).toEqual({});
    expect(next.clientId).toBe('cl1');
    expect(next.creditId).toBe(CREDIT);
    expect(next.scheduledDate).toBe('2026-07-10');
    expect(next.scheduledTime).toBe('15:30');
    expect(canSubmit(next)).toBe(false); // la visita todavía no tiene dirección
  });

  it('cambiar de cliente descarta el crédito y los details (son de otro cliente)', () => {
    const next = formReducer(readyCall(), { t: 'client', clientId: 'cl2' });
    expect(next).toMatchObject({ clientId: 'cl2', caseId: null, creditId: null, details: {} });
  });
});

describe('buildPayload', () => {
  it('manda hora sólo en FIXED y franja sólo en LAPSE', () => {
    expect(buildPayload(readyCall())).toMatchObject({ scheduledTime: '15:30', timeSlot: undefined });

    const lapse = formReducer(formReducer(readyCall(), { t: 'timeMode', value: ScheduleTimeMode.LAPSE }), {
      t: 'slot',
      value: AgendaTimeSlot.AFTERNOON,
    });
    expect(buildPayload(lapse)).toMatchObject({ scheduledTime: undefined, timeSlot: 'AFTERNOON' });
  });

  it('normaliza las observaciones vacías a undefined y devuelve null si falta algo', () => {
    expect(buildPayload(readyCall())?.observations).toBeUndefined();
    expect(buildPayload(formReducer(readyCall(), { t: 'observations', value: '  Insiste  ' }))?.observations).toBe('Insiste');
    expect(buildPayload(initialForm('2026-07-10'))).toBeNull();
  });
});
