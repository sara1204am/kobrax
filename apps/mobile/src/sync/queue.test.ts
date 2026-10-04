/**
 * El envío de una acción encolada. El caso que importa es la visita compuesta: cuando sube, tiene
 * que reproducir exactamente lo que la pantalla habría hecho con señal — visita, foto, cobro y
 * promesa, **en ese orden**, y con la clave de idempotencia derivada de la visita ya creada.
 */
const mockCalls: string[] = [];
const mockState: { visit: Record<string, unknown>; upload: Record<string, unknown> } = {
  visit: { status: 'ok', data: { id: 'v1' } },
  upload: { status: 'ok', url: 'http://x/f.jpg', hash: 'h1' },
};
const mockPayment: { idem?: string; input?: Record<string, unknown> } = {};
const mockMora: { res: Record<string, unknown> } = { res: { status: 'ok', data: {} } };

jest.mock('../field.service', () => ({
  createVisit: jest.fn(async () => {
    mockCalls.push('createVisit');
    return mockState.visit;
  }),
  addVisitEvidence: jest.fn(async () => {
    mockCalls.push('addVisitEvidence');
    return { status: 'ok', data: {} };
  }),
}));
jest.mock('../uploads.service', () => ({
  uploadImage: jest.fn(async () => {
    mockCalls.push('uploadImage');
    return mockState.upload;
  }),
}));
jest.mock('../payments.service', () => ({
  createPayment: jest.fn(async (input: Record<string, unknown>, idem: string) => {
    mockCalls.push('createPayment');
    mockPayment.idem = idem;
    mockPayment.input = input;
    return { status: 'ok', data: {} };
  }),
}));
jest.mock('../agenda.service', () => ({
  createItem: jest.fn(async () => {
    mockCalls.push('createItem');
    return { status: 'ok', data: {} };
  }),
  completeItem: jest.fn(async () => ({ status: 'ok', data: {} })),
  postponeItem: jest.fn(async () => ({ status: 'ok', data: {} })),
  cancelItem: jest.fn(async (id: string, reasonCode: string) => {
    mockCalls.push(`cancelItem:${id}:${reasonCode}`);
    return { status: 'ok', data: {} };
  }),
  rescheduleItem: jest.fn(async (id: string, input: { scheduledDate: string }) => {
    mockCalls.push(`rescheduleItem:${id}:${input.scheduledDate}`);
    return { status: 'ok', data: {} };
  }),
}));
jest.mock('../db', () => ({ enqueue: jest.fn(async () => 1), pending: jest.fn(async () => []) }));
jest.mock('../session', () => ({ getUserId: jest.fn(async () => 'u1') }));
jest.mock('../routes.service', () => ({ updateRouteStatus: jest.fn(async () => ({ status: 'ok', data: {} })) }));
jest.mock('../cases.service', () => ({ addActivity: jest.fn(async () => ({ status: 'ok', data: {} })) }));
jest.mock('../clients.service', () => ({
  createClient: jest.fn(async (input: { id?: string }) => {
    mockCalls.push(`createClient:${input.id}`);
    return { status: 'ok', data: { id: input.id } };
  }),
}));
jest.mock('../credits.service', () => ({
  createCredit: jest.fn(async (input: { id?: string; clientId?: string }) => {
    mockCalls.push(`createCredit:${input.id}:cliente=${input.clientId}`);
    return { status: 'ok', data: { id: input.id } };
  }),
  markArrears: jest.fn(async (creditId: string, days?: number) => {
    mockCalls.push(`markArrears:${creditId}:${days ?? '-'}`);
    return { status: 'ok', data: {} };
  }),
  clearArrears: jest.fn(async (creditId: string, input: { mode: string; date?: string }) => {
    mockCalls.push(`clearArrears:${creditId}:${input.mode}:${input.date ?? '-'}`);
    return { status: 'ok', data: {} };
  }),
}));

jest.mock('../mora.service', () => ({
  addMoraActivity: jest.fn(async (creditId: string, input: { id?: string; type: string }) => {
    mockCalls.push(`addMoraActivity:${creditId}:${input.id}:${input.type}`);
    return mockMora.res;
  }),
  addMoraNote: jest.fn(async (creditId: string, input: { id?: string }) => {
    mockCalls.push(`addMoraNote:${creditId}:${input.id}`);
    return mockMora.res;
  }),
}));

import { ACTION_LABEL, send } from './queue';

const visitInput = { caseId: 'c1', lat: -17.7, lng: -63.1, outcome: 'PAID' } as never;

beforeEach(() => {
  mockCalls.length = 0;
  mockState.visit = { status: 'ok', data: { id: 'v1' } };
  mockState.upload = { status: 'ok', url: 'http://x/f.jpg', hash: 'h1' };
  delete mockPayment.idem;
  mockMora.res = { status: 'ok', data: {} };
});

describe('send · visita compuesta', () => {
  it('sube visita, foto, cobro y promesa en ese orden', async () => {
    const r = await send({
      kind: 'visit',
      input: visitInput,
      photo: { uri: 'file:///f.jpg' },
      payment: { creditId: 'cr1', caseId: 'c1', amount: 100, method: 'CASH' },
      promise: { caseId: 'c1', creditId: 'cr1' } as never,
    });
    expect(r.status).toBe('ok');
    expect(mockCalls).toEqual(['createVisit', 'uploadImage', 'addVisitEvidence', 'createPayment', 'createItem']);
  });

  // Es la garantía anti doble cobro: la llave sale de la visita, que el server crea una sola vez.
  it('la clave de idempotencia del cobro sale de la visita recién creada', async () => {
    await send({
      kind: 'visit',
      input: visitInput,
      payment: { creditId: 'cr1', caseId: 'c1', amount: 100, method: 'CASH' },
    });
    expect(mockPayment.idem).toBe('visit-v1');
  });

  it('la foto subida queda como comprobante del cobro', async () => {
    await send({
      kind: 'visit',
      input: visitInput,
      photo: { uri: 'file:///f.jpg' },
      payment: { creditId: 'cr1', caseId: 'c1', amount: 100, method: 'CASH' },
    });
    expect(mockPayment.input).toMatchObject({ receiptUrl: 'http://x/f.jpg', receiptHash: 'h1' });
  });

  // Si la visita no salió, NADA de lo que cuelga de ella puede salir: sin id no hay a qué colgarlo.
  it('si la visita falla, no intenta el resto', async () => {
    mockState.visit = { status: 'error', message: 'boom' };
    const r = await send({
      kind: 'visit',
      input: visitInput,
      payment: { creditId: 'cr1', caseId: 'c1', amount: 100, method: 'CASH' },
    });
    expect(r.status).toBe('error');
    expect(mockCalls).toEqual(['createVisit']);
  });

  // Reintentar toda la acción duplicaría la parada visitada: la visita ya quedó registrada.
  it('una foto que no sube NO hace fallar la acción entera', async () => {
    mockState.upload = { status: 'error', message: 'archivo ilegible' };
    const r = await send({ kind: 'visit', input: visitInput, photo: { uri: 'file:///f.jpg' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).not.toContain('addVisitEvidence');
  });
});

/**
 * El alta en la calle: cliente y préstamo se dan de alta sin señal y suben después. Lo que hace
 * que esto funcione es que **el id lo pone el teléfono**, así el préstamo puede nombrar a un
 * cliente que todavía no llegó al servidor.
 */
describe('send · altas offline', () => {
  it('sube el alta de cliente con el id que se generó en el teléfono', async () => {
    await send({ kind: 'client.create', input: { id: 'cli-1', clientType: 'PERSON', firstName: 'Ana' } });
    expect(mockCalls).toContain('createClient:cli-1');
  });

  // Sin esto, el préstamo tendría que esperar la respuesta del alta del cliente para saber de
  // quién es — imposible sin señal, que es justo cuando hace falta.
  it('el préstamo viaja apuntando al cliente creado offline', async () => {
    await send({
      kind: 'credit.create',
      input: { id: 'cre-1', clientId: 'cli-1', principalAmount: 1000, installmentAmount: 100 } as never,
    });
    expect(mockCalls).toContain('createCredit:cre-1:cliente=cli-1');
  });

  it('cancelar y reagendar viajan con su motivo', async () => {
    await send({ kind: 'agenda.cancel', id: 'a1', reasonCode: 'NO_ESTABA' });
    await send({
      kind: 'agenda.reschedule',
      id: 'a2',
      input: { scheduledDate: '2026-08-20', timeMode: 'LAPSE', timeSlot: 'MORNING', reasonCode: 'PIDIO_OTRO_DIA' } as never,
    });
    expect(mockCalls).toEqual(['cancelItem:a1:NO_ESTABA', 'rescheduleItem:a2:2026-08-20']);
  });

  it('marcar en mora viaja con los días que puso el cobrador', async () => {
    await send({ kind: 'arrears.mark', creditId: 'cr1', days: 15 });
    expect(mockCalls).toContain('markArrears:cr1:15');
  });

  /**
   * 🔴 **La prueba que evita regalarle un mes al deudor.**
   *
   * El servidor entiende `next_period`, que avanza un período *desde donde esté el crédito*. Encolado
   * así, un reintento —lo normal en una cola offline: se manda, se corta la señal antes de la
   * respuesta, se vuelve a mandar— correría el vencimiento **dos veces**. La pantalla resuelve la
   * fecha con `addPeriods` (la misma función que usa el servidor) y encola `date`, que escribe un
   * valor fijo: mandarlo diez veces deja la misma fecha.
   */
  it('poner al día se reintenta sin correr la fecha dos veces', async () => {
    const accion = { kind: 'arrears.clear', creditId: 'cr1', input: { mode: 'date', date: '2026-09-17' } } as const;
    await send(accion);
    await send(accion); // el reintento de la cola
    expect(mockCalls).toEqual(['clearArrears:cr1:date:2026-09-17', 'clearArrears:cr1:date:2026-09-17']);
    expect(mockCalls.some((c) => c.includes('next_period'))).toBe(false);
  });

  it('«sin fecha de vencimiento» también es idempotente', async () => {
    await send({ kind: 'arrears.clear', creditId: 'cr1', input: { mode: 'none' } });
    expect(mockCalls).toContain('clearArrears:cr1:none:-');
  });
});

describe('send · mora', () => {
  const ID = '33333333-3333-4333-8333-333333333333';

  // El id lo puso el teléfono: es lo que hace que reintentar no duplique la gestión ni su promesa.
  it('la gestión viaja con el mismo id con el que se encoló', async () => {
    const r = await send({ kind: 'mora.activity', creditId: 'cr1', input: { id: ID, type: 'CALL', result: 'NO_ANSWER' } });
    expect(r.status).toBe('ok');
    expect(mockCalls).toEqual([`addMoraActivity:cr1:${ID}:CALL`]);
  });

  it('la nota viaja con el mismo id con el que se encoló', async () => {
    await send({ kind: 'credit.note', creditId: 'cr1', input: { id: ID, body: 'Llamar después de las 18' } });
    expect(mockCalls).toEqual([`addMoraNote:cr1:${ID}`]);
  });

  it('un 4xx del servidor es definitivo y queda a la vista, no se reintenta', async () => {
    mockMora.res = { status: 'error', message: 'Ese id de nota ya pertenece a otro crédito.', httpStatus: 409 };
    const r = await send({ kind: 'credit.note', creditId: 'cr1', input: { id: ID, body: 'x' } });
    expect(r).toEqual({ status: 'error', message: 'Ese id de nota ya pertenece a otro crédito.', permanent: true });
  });

  it('sin red no es error: queda en la cola', async () => {
    mockMora.res = { status: 'offline' };
    expect((await send({ kind: 'mora.activity', creditId: 'cr1', input: { id: ID, type: 'CALL', result: 'NO_ANSWER' } })).status).toBe('offline');
  });

  it('las dos acciones se llaman en la hoja de pendientes', () => {
    expect(ACTION_LABEL['mora.activity']).toBe('Gestión de mora registrada');
    expect(ACTION_LABEL['credit.note']).toBe('Nota del crédito');
  });
});

describe('isPermanentRejection', () => {
  it('un 4xx es definitivo, salvo 408 y 429; un 5xx o sin status no', () => {
    const { isPermanentRejection } = jest.requireActual('./queue') as typeof import('./queue');
    expect(isPermanentRejection(400)).toBe(true);
    expect(isPermanentRejection(422)).toBe(true);
    expect(isPermanentRejection(408)).toBe(false);
    expect(isPermanentRejection(429)).toBe(false);
    expect(isPermanentRejection(500)).toBe(false);
    expect(isPermanentRejection(undefined)).toBe(false);
  });
});
