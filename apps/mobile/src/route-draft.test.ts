const mockStore = new Map<string, string>();
const mockRoute: { stops: unknown[] } = { stops: [] };

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
jest.mock('./routes.service', () => ({
  addStop: jest.fn(async () => ({ status: 'ok', data: {} })),
  removeStop: jest.fn(async () => ({ status: 'ok', data: null })),
  updateStop: jest.fn(async () => ({ status: 'ok', data: {} })),
  createRoute: jest.fn(),
  getRoute: jest.fn(async () => ({ status: 'ok', data: { stops: mockRoute.stops } })),
}));

import { RouteStopStatus } from '@kobrax/shared';
import { clearDraft, diffStops, emptyDraft, flushDraft, loadDraft, moveStop, saveDraft, withoutStop, withStop } from './route-draft';
import type { RouteStopItem } from './routes.service';

const HOY = '2026-10-03';
const comoUsuario = (id: string | null) => (id ? mockStore.set('k_user_id', id) : mockStore.delete('k_user_id'));

beforeEach(() => {
  mockStore.clear();
  mockRoute.stops = [];
});

const stop = (id: string, creditId: string, sequenceOrder: number, status = RouteStopStatus.PENDING): RouteStopItem => ({
  id,
  clientId: `cl-${creditId}`,
  creditId,
  sequenceOrder,
  status,
});

describe('borrador local (ediciones)', () => {
  it('agrega en orden y no duplica el mismo caso', () => {
    let d = emptyDraft('2026-07-28');
    d = withStop(d, 'cr1', 'cl1');
    d = withStop(d, 'cr2', 'cl2');
    d = withStop(d, 'cr1', 'cl1'); // segundo toque sobre el mismo pin
    expect(d.creditIds).toEqual(['cr1', 'cr2']);
    expect(d.clientByCredit).toEqual({ cr1: 'cl1', cr2: 'cl2' });
  });

  it('quitar saca el caso y su cliente', () => {
    let d = withStop(withStop(emptyDraft('2026-07-28'), 'cr1', 'cl1'), 'cr2', 'cl2');
    d = withoutStop(d, 'cr1');
    expect(d.creditIds).toEqual(['cr2']);
    expect(d.clientByCredit).toEqual({ cr2: 'cl2' });
  });

  it('mover respeta los bordes: la primera no sube, la última no baja', () => {
    let d = emptyDraft('2026-07-28');
    for (const c of ['cr1', 'cr2', 'cr3']) d = withStop(d, c, `cl-${c}`);
    expect(moveStop(d, 'cr3', -1).creditIds).toEqual(['cr1', 'cr3', 'cr2']);
    expect(moveStop(d, 'cr1', -1).creditIds).toEqual(['cr1', 'cr2', 'cr3']); // ya es la primera
    expect(moveStop(d, 'cr3', 1).creditIds).toEqual(['cr1', 'cr2', 'cr3']); // ya es la última
  });
});

describe('diffStops', () => {
  it('server vacío: todo se agrega', () => {
    expect(diffStops(['cr1', 'cr2'], [])).toEqual({ toAdd: ['cr1', 'cr2'], toRemove: [], toMove: [] });
  });

  it('server igual al borrador: no hay nada que hacer (idempotente)', () => {
    const d = diffStops(['cr1', 'cr2'], [stop('s1', 'cr1', 1), stop('s2', 'cr2', 2)]);
    expect(d).toEqual({ toAdd: [], toRemove: [], toMove: [] });
  });

  it('lo que ya no está en el borrador se quita', () => {
    const d = diffStops(['cr1'], [stop('s1', 'cr1', 1), stop('s2', 'cr2', 2)]);
    expect(d.toRemove).toEqual(['s2']);
    expect(d.toAdd).toEqual([]);
  });

  it('el orden del borrador manda: devuelve las posiciones a corregir', () => {
    const d = diffStops(['cr2', 'cr1'], [stop('s1', 'cr1', 1), stop('s2', 'cr2', 2)]);
    expect(d.toMove).toEqual([
      { stopId: 's2', sequenceOrder: 1 },
      { stopId: 's1', sequenceOrder: 2 },
    ]);
  });

  it('una parada ya visitada no se toca ni se cuenta como sobrante', () => {
    const server = [stop('s1', 'cr1', 1, RouteStopStatus.VISITED), stop('s2', 'cr2', 2)];
    const d = diffStops(['cr2'], server);
    expect(d.toRemove).toEqual([]); // s1 es historia de la jornada
    expect(d.toAdd).toEqual([]);
    expect(d.toMove).toEqual([]); // s2 ya está en la posición 2 (después de la visitada)
  });

  it('las posiciones se cuentan después de las paradas ya gestionadas', () => {
    const server = [stop('s1', 'cr1', 1, RouteStopStatus.VISITED), stop('s2', 'cr2', 2), stop('s3', 'cr3', 3)];
    const d = diffStops(['cr3', 'cr2'], server);
    expect(d.toMove).toEqual([
      { stopId: 's3', sequenceOrder: 2 },
      { stopId: 's2', sequenceOrder: 3 },
    ]);
  });
});

/**
 * El borrador es del usuario: en un teléfono compartido (o tras cambiar de cuenta) el recorrido a medio armar de
 * uno no puede aparecerle al siguiente — ni sincronizarse con la sesión del otro.
 */
describe('borrador por usuario', () => {
  const conCredito = (): ReturnType<typeof emptyDraft> => withStop(emptyDraft(HOY), 'cr1', 'cl1');

  it('guarda bajo una clave con el id del usuario', async () => {
    comoUsuario('u1');
    await saveDraft(conCredito());
    expect([...mockStore.keys()].filter((k) => k.startsWith('kobrax.route.draft'))).toEqual(['kobrax.route.draft.u1']);
  });

  it('otro usuario en el mismo teléfono NO ve el borrador del anterior', async () => {
    comoUsuario('u1');
    await saveDraft(conCredito());
    comoUsuario('u2');
    expect((await loadDraft(HOY)).creditIds).toEqual([]);
    comoUsuario('u1');
    expect((await loadDraft(HOY)).creditIds).toEqual(['cr1']);
  });

  it('un borrador heredado de la versión anterior (clave sin dueño) se DESCARTA, no se migra', async () => {
    comoUsuario('u1');
    mockStore.set('kobrax.route.draft', JSON.stringify({ ...conCredito() }));
    const d = await loadDraft(HOY);
    expect(d.creditIds).toEqual([]);
    expect(mockStore.has('kobrax.route.draft')).toBe(false);
  });

  it('sin usuario no hay dónde guardarlo ni qué leer', async () => {
    comoUsuario(null);
    await saveDraft(conCredito());
    expect([...mockStore.keys()]).toEqual([]);
    expect((await loadDraft(HOY)).creditIds).toEqual([]);
  });

  it('clearDraft borra el del usuario y el heredado', async () => {
    comoUsuario('u1');
    await saveDraft(conCredito());
    mockStore.set('kobrax.route.draft', '{}');
    await clearDraft();
    expect([...mockStore.keys()].filter((k) => k.startsWith('kobrax.route.draft'))).toEqual([]);
  });

  it('un borrador de otro día no se arrastra', async () => {
    comoUsuario('u1');
    await saveDraft(conCredito());
    expect((await loadDraft('2026-10-04')).creditIds).toEqual([]);
  });
});

/**
 * Crear la ruta lleva un id del teléfono: si el primer POST llegó y se perdió la respuesta, el reintento manda el
 * MISMO id y el server devuelve la ruta ya creada en vez de crear otra (o rebotar con «ya hay una ruta hoy»).
 */
describe('flushDraft · id de la ruta', () => {
  const borrador = () => withStop(emptyDraft(HOY), 'cr1', 'cl1');

  it('pasa un id al crearla y lo guarda en el borrador ANTES de llamar', async () => {
    comoUsuario('u1');
    let guardadoAntes: { createId?: string } | null = null;
    const create = jest.fn(async (id: string) => {
      guardadoAntes = JSON.parse(mockStore.get('kobrax.route.draft.u1')!);
      return { status: 'ok', data: { id: 'ruta-1' } };
    });
    const r = await flushDraft(borrador(), create);
    expect(r.status).toBe('ok');
    const id = create.mock.calls[0]![0];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(guardadoAntes!.createId).toBe(id);
  });

  it('si se pierde la respuesta (offline), el reintento usa el MISMO id aunque la pantalla guarde su copia sin él', async () => {
    comoUsuario('u1');
    const ids: string[] = [];
    const create = jest.fn(async (id: string) => {
      ids.push(id);
      return { status: 'offline' };
    });
    const d = borrador();
    expect((await flushDraft(d, create)).status).toBe('offline');
    // La pantalla vuelve a guardar SU copia (sin createId) al tocar otro pin: no puede perder el id.
    await saveDraft(withStop(d, 'cr2', 'cl2'));
    await flushDraft(await loadDraft(HOY), create);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
  });

  it('con ruta ya creada no vuelve a pedir crearla', async () => {
    comoUsuario('u1');
    const create = jest.fn();
    const r = await flushDraft({ ...borrador(), routeId: 'ya-existe' }, create);
    expect(create).not.toHaveBeenCalled();
    expect(r.status).toBe('ok');
  });
});

describe('por crédito (F4/08)', () => {
  it('dos créditos del mismo cliente son dos paradas distintas', () => {
    let d = emptyDraft(HOY);
    d = withStop(d, 'cr1', 'cl1');
    d = withStop(d, 'cr2', 'cl1');
    expect(d.creditIds).toEqual(['cr1', 'cr2']);
    expect(d.clientByCredit).toEqual({ cr1: 'cl1', cr2: 'cl1' });
  });

  it('diffStops cruza por creditId, no por cliente: una parada sin crédito se quita', () => {
    const sinCredito = { id: 's9', clientId: 'cl1', sequenceOrder: 1, status: RouteStopStatus.PENDING } as RouteStopItem;
    const d = diffStops(['cr1'], [sinCredito]);
    expect(d.toRemove).toEqual(['s9']);
    expect(d.toAdd).toEqual(['cr1']);
  });

  it('al sincronizar, cada parada nueva viaja con {clientId, creditId}', async () => {
    comoUsuario('u1');
    const { addStop } = jest.requireMock('./routes.service') as { addStop: jest.Mock };
    addStop.mockClear();
    let d = withStop(emptyDraft(HOY), 'cr1', 'cl1');
    d = withStop(d, 'cr2', 'cl1');
    const r = await flushDraft({ ...d, routeId: 'ruta-1' }, jest.fn());
    expect(r.status).toBe('ok');
    expect(addStop.mock.calls.map((c) => c[1])).toEqual([
      { clientId: 'cl1', creditId: 'cr1' },
      { clientId: 'cl1', creditId: 'cr2' },
    ]);
  });

  it('un borrador guardado con la forma vieja (caseIds) se descarta', async () => {
    comoUsuario('u1');
    mockStore.set('kobrax.route.draft.u1', JSON.stringify({ routeId: null, date: HOY, caseIds: ['x'], clientByCase: { x: 'c' } }));
    expect((await loadDraft(HOY)).creditIds).toEqual([]);
  });
});
