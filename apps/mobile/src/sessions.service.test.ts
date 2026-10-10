const mockQuery = jest.fn();
const mockMutate = jest.fn();
jest.mock('./api-client', () => ({
  apiQuery: (...a: unknown[]) => mockQuery(...a),
  apiMutate: (...a: unknown[]) => mockMutate(...a),
}));

import { listSessions, revokeOtherSessions, revokeSession, sessionTitle } from './sessions.service';

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ status: 'ok', data: [], total: 0 });
  mockMutate.mockReset().mockResolvedValue({ status: 'ok', data: null });
});

describe('sesiones (U3)', () => {
  it('lista, revoca una y revoca las demás con los verbos del contrato', async () => {
    await listSessions();
    expect(mockQuery).toHaveBeenCalledWith('/auth/sessions');
    await revokeSession('abc/1');
    expect(mockMutate).toHaveBeenLastCalledWith('/auth/sessions/abc%2F1', 'DELETE');
    await revokeOtherSessions();
    expect(mockMutate).toHaveBeenLastCalledWith('/auth/sessions', 'DELETE');
  });

  it('sessionTitle: dispositivo reconocible, con y sin detalle', () => {
    expect(sessionTitle({ deviceType: 'mobile', deviceName: 'Moto G' })).toBe('Teléfono · Moto G');
    expect(sessionTitle({ deviceType: 'web', os: 'Windows' })).toBe('Navegador · Windows');
    expect(sessionTitle({})).toBe('Dispositivo');
  });
});
