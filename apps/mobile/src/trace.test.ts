/**
 * El rastro de «Llamar / WhatsApp / Navegar» va por crédito y es una NOTA (el validador compartido exige un resultado
 * para CALL/MESSAGE/VISIT, y tocar el botón no sabe cómo salió). Lleva un id fijado antes del primer intento y el
 * mismo viaja a la cola, para que un reintento no lo duplique.
 */
const mockAdd = jest.fn();
const mockQueue = jest.fn(async (_a: unknown) => true);
jest.mock('./mora.service', () => ({ addMoraActivity: (...a: unknown[]) => mockAdd(...a) }));
jest.mock('./sync/sync.service', () => ({ queueForLater: (a: unknown) => mockQueue(a) }));

import { RECOVERY_ACTIVITY_TYPES, validateRecoveryActivity } from '@kobrax/shared';
import { registrarRastro } from './trace';

beforeEach(() => {
  mockAdd.mockReset();
  mockQueue.mockClear();
});

describe('registrarRastro', () => {
  it('con señal manda una nota al crédito, con id, y no encola nada', async () => {
    mockAdd.mockResolvedValue({ status: 'ok', data: {} });
    await registrarRastro('cr1', 'call');
    const [creditId, input] = mockAdd.mock.calls[0]!;
    expect(creditId).toBe('cr1');
    expect(input).toMatchObject({ type: 'NOTE', notes: 'Llamada', id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(mockQueue).not.toHaveBeenCalled();
  });

  it('lo que manda lo acepta el validador del servidor (una nota sin resultado)', async () => {
    mockAdd.mockResolvedValue({ status: 'ok', data: {} });
    for (const kind of ['call', 'whatsapp', 'navigate'] as const) {
      await registrarRastro('cr1', kind);
      const input = mockAdd.mock.calls.at(-1)![1];
      expect(RECOVERY_ACTIVITY_TYPES).toContain(input.type);
      expect(validateRecoveryActivity(input, '2026-10-04')).toBeNull();
    }
  });

  it('sin señal lo encola como mora.activity con el MISMO id del intento', async () => {
    mockAdd.mockResolvedValue({ status: 'offline' });
    await registrarRastro('cr1', 'whatsapp');
    const enviado = mockAdd.mock.calls[0]![1];
    expect(mockQueue).toHaveBeenCalledWith({ kind: 'mora.activity', creditId: 'cr1', input: enviado });
    expect(enviado.notes).toBe('WhatsApp');
  });

  it('un rechazo del servidor no se encola (reintentar daría lo mismo)', async () => {
    mockAdd.mockResolvedValue({ status: 'error', message: 'no', httpStatus: 400 });
    await registrarRastro('cr1', 'navigate');
    expect(mockQueue).not.toHaveBeenCalled();
  });
});
