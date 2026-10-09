/**
 * La base es un mapa en memoria con la misma forma que el caché real: listas por (kind, scope) y fichas por (kind, id).
 */
const mockLists = new Map<string, unknown[]>();
const mockOnes = new Map<string, unknown>();
const listKey = (kind: string, scope: string) => `${kind}|${scope}`;

jest.mock('../db', () => ({
  getMany: jest.fn(async (kind: string, scope: string) => [...(mockLists.get(listKey(kind, scope)) ?? [])]),
  replaceAll: jest.fn(async (kind: string, rows: unknown[], scope: string) => void mockLists.set(listKey(kind, scope), rows)),
  getOne: jest.fn(async (kind: string, id: string) => mockOnes.get(listKey(kind, id)) ?? null),
  putOne: jest.fn(async (kind: string, id: string, value: unknown) => void mockOnes.set(listKey(kind, id), value)),
}));
jest.mock('../tenant-day', () => ({ todayISO: () => '2026-10-07' }));

import type { AgendaListItem } from '@kobrax/shared';
import { agendaScopesFor, patchAgendaItemLocal } from './agenda-optimistic';

const item = (id: string, scheduledDate: string, over: Record<string, unknown> = {}) =>
  ({ id, scheduledDate: `${scheduledDate}T00:00:00.000Z`, status: 'SCHEDULED', ...over }) as unknown as AgendaListItem;

const rows = (kind: string, scope: string) => (mockLists.get(listKey(kind, scope)) ?? []) as AgendaListItem[];

beforeEach(() => {
  mockLists.clear();
  mockOnes.clear();
});

describe('patchAgendaItemLocal (lo hecho sin señal se ve ya)', () => {
  it('una ejecutada cambia de estado en la lista de hoy: el contador de pendientes baja', async () => {
    const hoy = item('g1', '2026-10-07');
    mockLists.set(listKey('agenda', '2026-10-07'), [hoy, item('g2', '2026-10-07')]);
    await patchAgendaItemLocal(hoy, { status: 'EXECUTED' as never });
    expect(rows('agenda', '2026-10-07').map((r) => [r.id, r.status])).toEqual([['g1', 'EXECUTED'], ['g2', 'SCHEDULED']]);
  });

  it('una vencida que se ejecuta sale de las dos listas de vencidas y baja su total', async () => {
    const vieja = item('v1', '2026-10-01', { isOverdue: true });
    mockLists.set(listKey('agenda', 'overdue:limit=100'), [vieja, item('v2', '2026-10-02')]);
    mockLists.set(listKey('agenda', 'overdue:limit=1'), [vieja]);
    mockOnes.set(listKey('list.meta', 'agenda|overdue:limit=1'), { total: 5 });
    mockOnes.set(listKey('list.meta', 'agenda|overdue:limit=100'), { total: 5 });

    await patchAgendaItemLocal(vieja, { status: 'EXECUTED' as never });

    expect(rows('agenda', 'overdue:limit=100').map((r) => r.id)).toEqual(['v2']);
    expect(rows('agenda', 'overdue:limit=1')).toEqual([]);
    // El Inicio lee ese total para el tile «Vencidos»: tiene que bajar aunque la consulta traiga 1 sola fila.
    expect(mockOnes.get(listKey('list.meta', 'agenda|overdue:limit=1'))).toEqual({ total: 4 });
  });

  it('el total de vencidas nunca baja de cero', async () => {
    const vieja = item('v1', '2026-10-01');
    mockLists.set(listKey('agenda', 'overdue:limit=1'), [vieja]);
    mockOnes.set(listKey('list.meta', 'agenda|overdue:limit=1'), { total: 0 });
    await patchAgendaItemLocal(vieja, { status: 'CANCELLED' as never });
    expect(mockOnes.get(listKey('list.meta', 'agenda|overdue:limit=1'))).toEqual({ total: 0 });
  });

  it('un cambio que la deja pendiente (posponer) no la saca de la lista de vencidas', async () => {
    const vieja = item('v1', '2026-10-01');
    mockLists.set(listKey('agenda', 'overdue:limit=100'), [vieja]);
    await patchAgendaItemLocal(vieja, { scheduledTime: '15:30' });
    expect(rows('agenda', 'overdue:limit=100')).toHaveLength(1);
    expect(rows('agenda', 'overdue:limit=100')[0]!.scheduledTime).toBe('15:30');
  });

  it('actualiza también el detalle guardado, para que abrirla sin señal la muestre ya hecha', async () => {
    const g = item('g1', '2026-10-07');
    mockOnes.set(listKey('agenda.detail', 'g1'), { item: g, client: { displayName: 'Ana' }, history: [] });
    await patchAgendaItemLocal(g, { status: 'EXECUTED' as never });
    expect((mockOnes.get(listKey('agenda.detail', 'g1')) as { item: AgendaListItem; client: unknown }).item.status).toBe('EXECUTED');
    expect((mockOnes.get(listKey('agenda.detail', 'g1')) as { client: { displayName: string } }).client.displayName).toBe('Ana');
  });

  it('no inventa filas: lo que no estaba guardado queda como estaba', async () => {
    await patchAgendaItemLocal(item('nuevo', '2026-10-07'), { status: 'EXECUTED' as never });
    expect(mockLists.size).toBe(0);
    expect(mockOnes.size).toBe(0);
  });
});

describe('agendaScopesFor', () => {
  it('su día, hoy y las dos consultas de vencidas, sin repetir', () => {
    expect(agendaScopesFor(item('x', '2026-10-09'))).toEqual(['2026-10-09', '2026-10-07', 'overdue:limit=1', 'overdue:limit=100']);
    expect(agendaScopesFor(item('x', '2026-10-07'))).toEqual(['2026-10-07', 'overdue:limit=1', 'overdue:limit=100']);
  });
});
