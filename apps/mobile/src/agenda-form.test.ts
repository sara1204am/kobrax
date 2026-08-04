import { AgendaItemStatus, AgendaItemType, AgendaTimeSlot, ScheduleTimeMode } from '@kobrax/shared';
import {
  buildPatch,
  buildPayload,
  canSubmit,
  formReducer,
  hydrateForm,
  initialForm,
  money,
  partitionDay,
  type FormState,
} from './agenda-form';
import { actionLinks, whatsappLink, type AgendaListItem } from './agenda.service';

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

/** Agendado tal como lo devuelve el API, para hidratar el formulario en modo edición (S5). */
function savedItem(over: Partial<AgendaListItem> = {}): AgendaListItem {
  return {
    id: 'a1', caseId: CASE, clientId: 'cl1', creditId: CREDIT, assigneeId: 'u1',
    type: AgendaItemType.CALL, status: AgendaItemStatus.SCHEDULED,
    scheduledDate: '2026-07-10T00:00:00.000Z', timeMode: ScheduleTimeMode.FIXED, scheduledTime: '15:30',
    details: { contactId: CONTACT }, isOverdue: false,
    createdAt: '2026-07-09T10:00:00.000Z', updatedAt: '2026-07-09T10:00:00.000Z',
    ...over,
  };
}

describe('hydrateForm + buildPatch (S5 — editar)', () => {
  it('reconstruye el formulario desde el agendado guardado', () => {
    const state = hydrateForm(savedItem({ observations: 'insistir' }));
    expect(state).toMatchObject({
      type: AgendaItemType.CALL,
      clientId: 'cl1',
      caseId: CASE,
      creditId: CREDIT,
      scheduledDate: '2026-07-10',
      scheduledTime: '15:30',
      observations: 'insistir',
      details: { contactId: CONTACT },
    });
    expect(canSubmit(state)).toBe(true);
  });

  it('hidrata una promesa con su monto y su medio de pago', () => {
    const details = { amount: 500.5, promiseDate: '2026-07-20', paymentMethodCode: 'CASH' };
    const state = hydrateForm(savedItem({ type: AgendaItemType.PROMISE_TO_PAY, details }));
    expect(state.details).toEqual(details);
    expect(canSubmit(state)).toBe(true);
  });

  it('hidrata un agendado por franja sin perder el lapso', () => {
    const state = hydrateForm(savedItem({ timeMode: ScheduleTimeMode.LAPSE, scheduledTime: undefined, timeSlot: 'NIGHT' }));
    expect(state).toMatchObject({ timeMode: ScheduleTimeMode.LAPSE, timeSlot: 'NIGHT', scheduledTime: '' });
    expect(canSubmit(state)).toBe(true); // por franja no hace falta hora exacta
  });

  it('el parche NUNCA lleva fecha ni deudor: mover el día es reagendar (D5)', () => {
    const patch = buildPatch(hydrateForm(savedItem()))!;
    expect(patch).not.toHaveProperty('scheduledDate');
    expect(patch).not.toHaveProperty('caseId');
    expect(patch).not.toHaveProperty('clientId');
    expect(patch).toMatchObject({ type: AgendaItemType.CALL, scheduledTime: '15:30', timeSlot: undefined });
  });

  it('cambiar el tipo limpia los details y bloquea el guardado hasta completarlos', () => {
    const edited = formReducer(hydrateForm(savedItem()), { t: 'type', value: AgendaItemType.REMINDER });
    expect(edited.details).toEqual({});
    expect(canSubmit(edited)).toBe(false);
    expect(buildPatch(edited)).toBeNull();
    // Con la descripción cargada, vuelve a poder guardarse — sin haber tocado cliente ni fecha.
    const ready = formReducer(edited, { t: 'details', patch: { description: 'Llevar el comprobante' } });
    expect(canSubmit(ready)).toBe(true);
    expect(ready.clientId).toBe('cl1');
    expect(ready.scheduledDate).toBe('2026-07-10');
  });
});

describe('partitionDay (D6 — secciones del día)', () => {
  const item = (id: string, status: AgendaItemStatus) => savedItem({ id, status });

  it('lo cancelado y lo reagendado siguen visibles, del lado de "Completadas"', () => {
    const { pending, done } = partitionDay([
      item('a', AgendaItemStatus.SCHEDULED),
      item('b', AgendaItemStatus.EXECUTED),
      item('c', AgendaItemStatus.CANCELLED),
      item('d', AgendaItemStatus.RESCHEDULED),
    ]);
    expect(pending.map((i) => i.id)).toEqual(['a']);
    // Sin esto una gestión cancelada desaparecía de la app y cancelar era igual que eliminar.
    expect(done.map((i) => i.id)).toEqual(['b', 'c', 'd']);
  });
});
