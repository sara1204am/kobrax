/**
 * D-5 · cerrar la jornada con paradas sin gestionar lleva su motivo, también por la cola offline; y el corte de versión
 * (426) marca el estado global sin descartar nada.
 */
const mockMutate = jest.fn();
jest.mock('./api-client', () => ({
  apiMutate: (...args: unknown[]) => mockMutate(...args),
  apiQuery: jest.fn(),
  toQuery: () => '',
}));
jest.mock('./sync/cached', () => ({ cachedOne: jest.fn(), cachedList: jest.fn() }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '1.1.0' } } }));

import { RouteStatus } from '@kobrax/shared';
import { updateRouteStatus } from './routes.service';
import { apiFetch } from './api';
import { useUpgradeStore } from './store/upgrade';

beforeEach(() => {
  mockMutate.mockReset();
  mockMutate.mockResolvedValue({ status: 'ok', data: {} });
  useUpgradeStore.getState().clear();
});

describe('updateRouteStatus · el motivo del cierre', () => {
  it('manda el motivo cuando lo hay', async () => {
    await updateRouteStatus('r1', RouteStatus.COMPLETED, 'Lluvia fuerte en la zona');
    expect(mockMutate).toHaveBeenCalledWith('/routes/r1', 'PATCH', { status: 'COMPLETED', reason: 'Lluvia fuerte en la zona' });
  });

  it('sin motivo manda solo el estado (iniciar, o cerrar sin pendientes)', async () => {
    await updateRouteStatus('r1', RouteStatus.IN_PROGRESS);
    expect(mockMutate).toHaveBeenCalledWith('/routes/r1', 'PATCH', { status: 'IN_PROGRESS' });
  });
});

describe('apiFetch · 426 (esta versión ya no es compatible)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('marca el estado global con el mensaje del servidor y devuelve el 426 tal cual', async () => {
    global.fetch = jest.fn(async () => ({
      status: 426,
      json: async () => ({ data: null, error: { code: 'APP_001', message: 'Actualizá a la versión 1.2.0' } }),
    })) as never;
    const res = await apiFetch('/routes');
    expect(res.status).toBe(426);
    expect(useUpgradeStore.getState().required).toBe(true);
    expect(useUpgradeStore.getState().message).toBe('Actualizá a la versión 1.2.0');
  });

  it('una respuesta normal no toca el estado', async () => {
    global.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ data: { ok: 1 }, error: null }) })) as never;
    await apiFetch('/routes');
    expect(useUpgradeStore.getState().required).toBe(false);
  });

  it('«Ya actualicé · reintentar» limpia el estado', () => {
    useUpgradeStore.getState().mark('x');
    useUpgradeStore.getState().clear();
    expect(useUpgradeStore.getState()).toMatchObject({ required: false, message: null });
  });
});
