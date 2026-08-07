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
}));

import { send } from './queue';

const visitInput = { caseId: 'c1', lat: -17.7, lng: -63.1, outcome: 'PAID' } as never;

beforeEach(() => {
  mockCalls.length = 0;
  mockState.visit = { status: 'ok', data: { id: 'v1' } };
  mockState.upload = { status: 'ok', url: 'http://x/f.jpg', hash: 'h1' };
  delete mockPayment.idem;
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
});
