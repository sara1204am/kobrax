import { RECOVERY_RESULTS_BY_TYPE, type RecoveryActivityType, type RecoveryResult } from '@kobrax/shared';

const mockApi = { activity: { status: 'ok' } as Record<string, unknown>, note: { status: 'ok' } as Record<string, unknown>, edit: { status: 'ok' } as Record<string, unknown> };
const mockSent: { activity: unknown[]; note: unknown[]; queued: unknown[] } = { activity: [], note: [], queued: [] };
let mockCanQueue = true;

jest.mock('./mora.service', () => ({
  addMoraActivity: jest.fn(async (creditId: string, input: unknown) => {
    mockSent.activity.push({ creditId, input });
    return mockApi.activity;
  }),
  addMoraNote: jest.fn(async (creditId: string, input: unknown) => {
    mockSent.note.push({ creditId, input });
    return mockApi.note;
  }),
  updateMoraNote: jest.fn(async () => mockApi.edit),
  deleteMoraNote: jest.fn(async () => mockApi.edit),
}));
jest.mock('./sync/sync.service', () => ({
  queueForLater: jest.fn(async (action: unknown) => {
    mockSent.queued.push(action);
    return mockCanQueue;
  }),
}));

import { MORA_OUTCOMES, submitMoraActivity, submitMoraNote, submitNoteDelete, submitNoteEdit } from './mora-actions';

beforeEach(() => {
  mockApi.activity = { status: 'ok' };
  mockApi.note = { status: 'ok' };
  mockApi.edit = { status: 'ok' };
  mockSent.activity = [];
  mockSent.note = [];
  mockSent.queued = [];
  mockCanQueue = true;
});

describe('MORA_OUTCOMES', () => {
  // El servidor rechaza un par que `RECOVERY_RESULTS_BY_TYPE` no permite: la hoja no puede ofrecerlo.
  it('cada resultado que ofrece la hoja lo permite el contrato compartido', () => {
    for (const o of MORA_OUTCOMES) {
      expect(RECOVERY_RESULTS_BY_TYPE[o.type as RecoveryActivityType]).toContain(o.result as RecoveryResult);
    }
  });

  it('sólo «Promesa de pago» lleva promesa, y es la única con ese resultado', () => {
    expect(MORA_OUTCOMES.filter((o) => o.promise).map((o) => o.result)).toEqual(['PROMISE_TO_PAY']);
    expect(MORA_OUTCOMES.filter((o) => o.result === 'PROMISE_TO_PAY').every((o) => o.promise)).toBe(true);
  });

  it('las claves no se repiten', () => {
    expect(new Set(MORA_OUTCOMES.map((o) => o.key)).size).toBe(MORA_OUTCOMES.length);
  });
});

describe('submitMoraActivity', () => {
  it('con señal: manda con un id y no encola', async () => {
    expect(await submitMoraActivity('cr1', { type: 'CALL', result: 'NO_ANSWER' })).toBeNull();
    const sent = mockSent.activity[0] as { input: { id: string } };
    expect(sent.input.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockSent.queued).toHaveLength(0);
  });

  // La garantía anti-duplicado: el intento y la cola llevan el MISMO id.
  it('🔴 sin señal: encola con el mismo id que se intentó', async () => {
    mockApi.activity = { status: 'offline' };
    expect(await submitMoraActivity('cr1', { type: 'CALL', result: 'NO_ANSWER' })).toBeNull();
    const intento = (mockSent.activity[0] as { input: { id: string } }).input.id;
    const encolada = mockSent.queued[0] as { kind: string; creditId: string; input: { id: string } };
    expect(encolada.kind).toBe('mora.activity');
    expect(encolada.creditId).toBe('cr1');
    expect(encolada.input.id).toBe(intento);
  });

  it('respeta un id que ya traía (reintento manual)', async () => {
    await submitMoraActivity('cr1', { id: 'fijo', type: 'CALL', result: 'NO_ANSWER' });
    expect((mockSent.activity[0] as { input: { id: string } }).input.id).toBe('fijo');
  });

  it('sin señal y sin poder guardar: lo dice', async () => {
    mockApi.activity = { status: 'offline' };
    mockCanQueue = false;
    expect(await submitMoraActivity('cr1', { type: 'CALL', result: 'NO_ANSWER' })).toMatch(/no se pudo guardar/);
  });

  it('un rechazo del servidor llega al cobrador con su mensaje y NO se encola', async () => {
    mockApi.activity = { status: 'error', message: 'La fecha de la promesa ya pasó.' };
    expect(await submitMoraActivity('cr1', { type: 'CALL', result: 'PROMISE_TO_PAY' })).toBe('La fecha de la promesa ya pasó.');
    expect(mockSent.queued).toHaveLength(0);
  });

  it('sesión vencida', async () => {
    mockApi.activity = { status: 'unauthenticated' };
    expect(await submitMoraActivity('cr1', { type: 'CALL', result: 'NO_ANSWER' })).toBe('Tu sesión venció.');
  });
});

describe('submitMoraNote', () => {
  it('sin señal: encola la nota con el mismo id del intento', async () => {
    mockApi.note = { status: 'offline' };
    expect(await submitMoraNote('cr1', { body: 'Llamar después de las 18' })).toBeNull();
    const intento = (mockSent.note[0] as { input: { id: string } }).input.id;
    const encolada = mockSent.queued[0] as { kind: string; input: { id: string; body: string } };
    expect(encolada.kind).toBe('credit.note');
    expect(encolada.input).toMatchObject({ id: intento, body: 'Llamar después de las 18' });
  });

  it('con señal no encola', async () => {
    expect(await submitMoraNote('cr1', { body: 'ok' })).toBeNull();
    expect(mockSent.queued).toHaveLength(0);
  });
});

describe('corregir y borrar una nota · sólo en línea', () => {
  it('con señal: null (listo)', async () => {
    expect(await submitNoteEdit('cr1', 'n1', { body: 'x' })).toBeNull();
    expect(await submitNoteDelete('cr1', 'n1')).toBeNull();
  });

  it('sin señal NO se encola y se dice con claridad', async () => {
    mockApi.edit = { status: 'offline' };
    expect(await submitNoteEdit('cr1', 'n1', { body: 'x' })).toContain('necesita conexión');
    expect(await submitNoteDelete('cr1', 'n1')).toContain('necesita conexión');
    expect(mockSent.queued).toEqual([]);
  });

  it('el rechazo del servidor llega al cobrador tal cual (p. ej. nota ajena)', async () => {
    mockApi.edit = { status: 'error', message: 'Sólo quien la escribió puede editarla', httpStatus: 403 };
    expect(await submitNoteEdit('cr1', 'n1', { body: 'x' })).toBe('Sólo quien la escribió puede editarla');
    mockApi.edit = { status: 'unauthenticated' };
    expect(await submitNoteDelete('cr1', 'n1')).toBe('Tu sesión venció.');
  });
});
