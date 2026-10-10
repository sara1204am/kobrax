const mockCreate = jest.fn();
const mockDecide = jest.fn();
const mockQueue = jest.fn();
jest.mock('./routes.service', () => ({
  createChangeRequest: (...a: unknown[]) => mockCreate(...a),
  decideChangeRequest: (...a: unknown[]) => mockDecide(...a),
  listChangeRequests: jest.fn(),
}));
jest.mock('./sync/sync.service', () => ({ queueForLater: (...a: unknown[]) => mockQueue(...a) }));

import { submitChangeRequest, submitDecision } from './route-change-requests';

beforeEach(() => {
  mockCreate.mockReset();
  mockDecide.mockReset();
  mockQueue.mockReset().mockResolvedValue(true);
});

describe('submitChangeRequest', () => {
  it('motivo corto: no llama ni encola', async () => {
    expect((await submitChangeRequest('r1', 'CANCEL', 'no')).status).toBe('invalid');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('con señal manda el id del teléfono y el motivo recortado', async () => {
    mockCreate.mockResolvedValue({ status: 'ok', data: {} });
    const r = await submitChangeRequest('r1', 'REMOVE_STOP', '  el cliente se mudó  ', { stopId: 's1' }, 'id-fijo');
    expect(r.status).toBe('ok');
    expect(mockCreate).toHaveBeenCalledWith('r1', { id: 'id-fijo', kind: 'REMOVE_STOP', reason: 'el cliente se mudó', payload: { stopId: 's1' } });
  });

  it('sin señal queda en la cola con el MISMO id (reintentar no duplica)', async () => {
    mockCreate.mockResolvedValue({ status: 'offline' });
    expect((await submitChangeRequest('r1', 'CANCEL', 'cambio de zona', undefined, 'id-fijo')).status).toBe('queued');
    expect(mockQueue).toHaveBeenCalledWith({
      kind: 'route.change.create',
      routeId: 'r1',
      input: { id: 'id-fijo', kind: 'CANCEL', reason: 'cambio de zona' },
    });
  });

  it('rechazo del servidor: mensaje', async () => {
    mockCreate.mockResolvedValue({ status: 'error', message: 'Esta ruta la armaste vos', httpStatus: 422 });
    expect(await submitChangeRequest('r1', 'CANCEL', 'cambio de zona')).toEqual({ status: 'error', message: 'Esta ruta la armaste vos' });
  });
});

describe('submitDecision', () => {
  it('con señal decide; sin señal encola el valor fijo', async () => {
    mockDecide.mockResolvedValueOnce({ status: 'ok', data: {} });
    expect((await submitDecision('r1', 'q1', 'APPROVE')).status).toBe('ok');
    mockDecide.mockResolvedValueOnce({ status: 'offline' });
    expect((await submitDecision('r1', 'q1', 'REJECT', 'ya no hace falta')).status).toBe('queued');
    expect(mockQueue).toHaveBeenCalledWith({ kind: 'route.change.decide', routeId: 'r1', requestId: 'q1', decision: 'REJECT', note: 'ya no hace falta' });
  });

  it('409 (ya lo resolvió otra persona): error visible, no éxito', async () => {
    mockDecide.mockResolvedValue({ status: 'error', message: 'Ya fue resuelto', httpStatus: 409 });
    expect(await submitDecision('r1', 'q1', 'APPROVE')).toEqual({ status: 'error', message: 'Ya fue resuelto' });
  });
});
