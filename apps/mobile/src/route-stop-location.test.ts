const mockUpdate = jest.fn();
const mockQueue = jest.fn();
jest.mock('./routes.service', () => ({ updateStop: (...a: unknown[]) => mockUpdate(...a) }));
jest.mock('./sync/sync.service', () => ({ queueForLater: (...a: unknown[]) => mockQueue(...a) }));

import { changeStopLocation } from './route-stop-location';

beforeEach(() => {
  mockUpdate.mockReset();
  mockQueue.mockReset().mockResolvedValue(true);
});

describe('changeStopLocation', () => {
  it('con señal manda el locationId', async () => {
    mockUpdate.mockResolvedValue({ status: 'ok', data: {} });
    expect(await changeStopLocation('r1', 's1', 'loc-b')).toEqual({ status: 'ok' });
    expect(mockUpdate).toHaveBeenCalledWith('r1', 's1', { locationId: 'loc-b' });
  });

  it('sin señal queda en la cola con valor fijo', async () => {
    mockUpdate.mockResolvedValue({ status: 'offline' });
    expect(await changeStopLocation('r1', 's1', 'loc-b')).toEqual({ status: 'queued' });
    expect(mockQueue).toHaveBeenCalledWith({ kind: 'route.stop.location', routeId: 'r1', stopId: 's1', locationId: 'loc-b' });
  });

  it('sin dónde guardar: error visible', async () => {
    mockUpdate.mockResolvedValue({ status: 'offline' });
    mockQueue.mockResolvedValue(false);
    expect((await changeStopLocation('r1', 's1', 'loc-b')).status).toBe('error');
  });

  it('rechazo del servidor (parada ya gestionada): mensaje y código', async () => {
    mockUpdate.mockResolvedValue({ status: 'error', message: 'La parada ya se gestionó', httpStatus: 422, code: 'ROUTE_STOP_DONE' });
    expect(await changeStopLocation('r1', 's1', 'loc-b')).toEqual({ status: 'error', message: 'La parada ya se gestionó', code: 'ROUTE_STOP_DONE' });
  });
});
