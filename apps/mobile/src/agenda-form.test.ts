import { AgendaItemType, AgendaTimeSlot, ScheduleTimeMode } from '@kobrax/shared';
import { buildPayload, canSubmit, formReducer, initialForm, money, type FormState } from './agenda-form';
import { actionLinks, whatsappLink } from './agenda.service';

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

describe('money', () => {
  it('formatea una moneda soportada y no explota con una que no lo está', () => {
    expect(money(8450, 'BOB')).toContain('8.450');
    expect(money(8450, 'GTQ')).toBe('8450.00 GTQ'); // fallback, no una pantalla en blanco
  });
});

describe('actionLinks (S3)', () => {
  it('sin target no hay botones', () => {
    expect(actionLinks(undefined)).toEqual({});
  });

  it('teléfono → tel:, limpiando separadores', () => {
    expect(actionLinks({ phone: '+591 780-12345' }).tel).toBe('tel:+59178012345');
    expect(actionLinks({ phone: '78012345' }).geo).toBeUndefined();
  });

  it('con coordenadas navega al punto', () => {
    expect(actionLinks({ address: 'Av. Siempre Viva 742', latitude: -17.78, longitude: -63.18 }).geo).toBe(
      'geo:-17.78,-63.18?q=-17.78,-63.18',
    );
  });

  it('dirección sin coordenadas navega por texto (S2 las hace opcionales)', () => {
    expect(actionLinks({ address: 'Calle Falsa 123' }).geo).toBe('geo:0,0?q=Calle%20Falsa%20123');
  });

  it('en iOS usa maps: — geo: no existe y Linking lo rechazaría', () => {
    expect(actionLinks({ address: 'Calle Falsa 123' }, 'ios').geo).toBe('maps:0,0?q=Calle%20Falsa%20123');
    expect(actionLinks({ latitude: -17.78, longitude: -63.18 }, 'ios').geo).toBe('maps:0,0?ll=-17.78,-63.18');
  });
});

describe('whatsappLink (S3)', () => {
  it('abre WhatsApp con el mensaje, no una llamada de voz', () => {
    expect(whatsappLink('+591 780-12345', 'Hola ¿coordinamos?')).toBe(
      'https://wa.me/59178012345?text=Hola%20%C2%BFcoordinamos%3F',
    );
  });

  it('sin mensaje, sólo el número', () => {
    expect(whatsappLink('78012345')).toBe('https://wa.me/78012345');
  });
});

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
