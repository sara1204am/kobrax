/**
 * Agenda: lo que decide cómo se guarda y cómo se manda — el scope de los vencidos y la hora absoluta de posponer.
 */
const mockScopes: string[] = [];
const mockBodies: { path: string; method: string; body: unknown }[] = [];

jest.mock('./sync/cached', () => ({
  cachedList: jest.fn(async (_kind: string, scope: string) => {
    mockScopes.push(scope);
    return { status: 'offline' };
  }),
  cachedOne: jest.fn(),
}));
jest.mock('./api-client', () => ({
  apiQuery: jest.fn(),
  apiMutate: jest.fn(async (path: string, method: string, body: unknown) => {
    mockBodies.push({ path, method, body });
    return { status: 'ok', data: {} };
  }),
  toQuery: jest.fn(() => ''),
}));

import { listOverdue, postponeItem, postponeTarget } from './agenda.service';

beforeEach(() => {
  mockScopes.length = 0;
  mockBodies.length = 0;
});

describe('listOverdue · scope por límite', () => {
  // El Home pide limit=1 (sólo el total) y la Agenda limit=100: con un scope único, la de 1 fila pisaba las 100.
  it('limit=1 y limit=100 NO comparten scope', async () => {
    await listOverdue(1);
    await listOverdue(100);
    expect(mockScopes).toHaveLength(2);
    expect(mockScopes[0]).not.toBe(mockScopes[1]);
  });

  it('el mismo límite sí cae en el mismo scope (la hidratación llena lo que la pantalla lee)', async () => {
    await listOverdue(100);
    await listOverdue();
    expect(mockScopes[0]).toBe(mockScopes[1]);
  });
});

describe('postponeItem', () => {
  it('con toTime manda la hora absoluta Y los minutos (compatibilidad con un server viejo)', async () => {
    await postponeItem('a1', 30, '10:30');
    expect(mockBodies[0]).toEqual({ path: '/agenda/a1/postpone', method: 'POST', body: { minutes: 30, toTime: '10:30' } });
  });

  it('sin toTime sigue mandando sólo minutes (ítems encolados antes del cambio)', async () => {
    await postponeItem('a1', 15);
    expect(mockBodies[0]!.body).toEqual({ minutes: 15 });
  });
});

describe('postponeTarget · hora absoluta de destino', () => {
  it('suma los minutos a la hora fija', () => {
    expect(postponeTarget({ scheduledTime: '10:00' }, 30)).toBe('10:30');
    expect(postponeTarget({ scheduledTime: '09:45:00' }, 15)).toBe('10:00');
    expect(postponeTarget({ scheduledTime: '09:00' }, 60)).toBe('10:00');
  });

  it('una franja parte del inicio de la franja (igual que el server)', () => {
    expect(postponeTarget({ timeSlot: 'MORNING' }, 30)).toBe('08:30');
    expect(postponeTarget({ timeSlot: 'AFTERNOON' }, 60)).toBe('14:00');
    expect(postponeTarget({ timeSlot: 'NIGHT' }, 15)).toBe('18:15');
  });

  it('sin hora ni franja parte de las 09:00', () => {
    expect(postponeTarget({}, 30)).toBe('09:30');
  });

  it('si cruza la medianoche no hay hora absoluta posible (toTime no lleva día): devuelve undefined', () => {
    expect(postponeTarget({ scheduledTime: '23:30' }, 60)).toBeUndefined();
    expect(postponeTarget({ scheduledTime: '23:45' }, 15)).toBeUndefined();
  });

  it('es determinista: repetir el cálculo da lo mismo (eso es lo que hace idempotente el reintento)', () => {
    const item = { scheduledTime: '10:00' };
    expect(postponeTarget(item, 30)).toBe(postponeTarget(item, 30));
  });
});
