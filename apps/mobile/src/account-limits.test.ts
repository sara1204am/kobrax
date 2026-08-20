/**
 * ¿Hay lugar en el plan para uno más?
 *
 * Lo que decide esta función es **si el cobrador se entera a tiempo**: el alta sale con id propio,
 * así que el servidor la acepta igual y el aviso sólo puede llegar acá, con la persona todavía
 * frente al deudor. Por eso también decide qué hacer cuando no sabe.
 */
const mockCuenta: { res: unknown } = { res: { status: 'offline' } };

jest.mock('./sync/cached', () => ({ cachedOne: jest.fn(async () => mockCuenta.res) }));
jest.mock('./api-client', () => ({ apiQuery: jest.fn(), apiMutate: jest.fn() }));
jest.mock('./api', () => ({ publicCall: jest.fn() }));

import { hayLugar } from './account.service';

const cuenta = (limits: Record<string, unknown>, usage: Record<string, number>) => ({
  status: 'ok',
  data: { limits, usage },
});

describe('hayLugar', () => {
  it('deja pasar mientras entre', async () => {
    mockCuenta.res = cuenta({ credits: 20 }, { credits: 19 });
    expect(await hayLugar('credits')).toBe(true);
  });

  it('avisa justo en el tope, no después', async () => {
    // En el tope ya no entra uno más: preguntar por «>=» y no por «>» es la diferencia entre
    // avisar antes de cargar el préstamo 21 y avisar cuando ya está cargado.
    mockCuenta.res = cuenta({ credits: 20 }, { credits: 20 });
    expect(await hayLugar('credits')).toBe(false);
  });

  it('sin tope siempre hay lugar', async () => {
    mockCuenta.res = cuenta({ credits: null }, { credits: 99_999 });
    expect(await hayLugar('credits')).toBe(true);
  });

  it('🔴 la duda NO frena al cobrador', async () => {
    // Teléfono recién instalado, sin señal y sin copia local de la cuenta: no saber cuánto queda
    // no puede convertirse en un «no puedo cargar este préstamo» en la puerta del deudor. El
    // freno de verdad lo pone el servidor; esto sólo avisa cuando puede.
    mockCuenta.res = { status: 'offline' };
    expect(await hayLugar('credits')).toBe(true);
    mockCuenta.res = { status: 'error', message: 'cualquier cosa' };
    expect(await hayLugar('clients')).toBe(true);
  });
});
