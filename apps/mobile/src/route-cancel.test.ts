const mockUpdate = jest.fn();
const mockQueue = jest.fn();
jest.mock('./routes.service', () => ({ updateRouteStatus: (...a: unknown[]) => mockUpdate(...a) }));
jest.mock('./sync/sync.service', () => ({ queueForLater: (...a: unknown[]) => mockQueue(...a) }));

import { RouteStatus } from '@kobrax/shared';
import { cancelRouteWithReason } from './route-cancel';

beforeEach(() => {
  mockUpdate.mockReset();
  mockQueue.mockReset().mockResolvedValue(true);
});

describe('cancelRouteWithReason', () => {
  it('motivo corto: ni llama ni encola', async () => {
    const r = await cancelRouteWithReason('r1', 'no');
    expect(r.status).toBe('invalid');
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockQueue).not.toHaveBeenCalled();
  });

  it('con señal: manda CANCELLED con el motivo recortado', async () => {
    mockUpdate.mockResolvedValue({ status: 'ok', data: {} });
    expect((await cancelRouteWithReason('r1', '  se cayó la visita  ')).status).toBe('cancelled');
    expect(mockUpdate).toHaveBeenCalledWith('r1', RouteStatus.CANCELLED, 'se cayó la visita');
  });

  it('sin señal o sesión vencida: queda en la cola con su motivo', async () => {
    for (const status of ['offline', 'unauthenticated']) {
      mockQueue.mockClear();
      mockUpdate.mockResolvedValue({ status });
      expect((await cancelRouteWithReason('r1', 'lluvia fuerte')).status).toBe('queued');
      expect(mockQueue).toHaveBeenCalledWith({ kind: 'route.status', routeId: 'r1', status: RouteStatus.CANCELLED, reason: 'lluvia fuerte' });
    }
  });

  it('sin dónde guardar: error visible, no éxito en silencio', async () => {
    mockUpdate.mockResolvedValue({ status: 'offline' });
    mockQueue.mockResolvedValue(false);
    expect((await cancelRouteWithReason('r1', 'lluvia fuerte')).status).toBe('error');
  });

  it('rechazo del servidor: devuelve mensaje y código', async () => {
    mockUpdate.mockResolvedValue({ status: 'error', message: 'Ya tiene visitas', httpStatus: 422, code: 'ROUTE_HAS_VISITS' });
    expect(await cancelRouteWithReason('r1', 'lluvia fuerte')).toEqual({ status: 'error', message: 'Ya tiene visitas', code: 'ROUTE_HAS_VISITS' });
  });
});
