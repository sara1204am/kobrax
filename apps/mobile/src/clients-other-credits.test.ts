/**
 * F14 · F2 (cruce con el móvil, RULES D1 · plan §8.1, D-6a): el móvil no cambia en F2.
 *
 *  · `GET /clients/:id` ahora trae `otherCredits` (sólo agregados). Es un campo ADITIVO: el móvil lo ignora y la ficha sigue viniendo
 *    completa.
 *  · Un cliente que el cobrador deja de ver responde 404 a lo que haya quedado en la cola. Una acción rechazada con 4xx es
 *    PERMANENTE (no se reintenta eternamente). Mostrarlo con un mensaje claro queda para F8.
 */
const mockApi: { res: unknown } = { res: { status: 'ok', data: {} } };

jest.mock('./api-client', () => ({
  apiQuery: jest.fn(async () => mockApi.res),
  apiMutate: jest.fn(),
  toQuery: jest.fn(() => ''),
}));
// El caché sólo guarda lo que baja del servidor; acá se salta para ver qué entrega `getClient`.
jest.mock('./sync/cached', () => ({ cachedOne: jest.fn(async (_kind: string, _id: string, fetcher: () => Promise<unknown>) => fetcher()) }));
jest.mock('./db', () => ({ getMany: jest.fn(), fetchedAt: jest.fn() }));

import { getClient } from './clients.service';

describe('GET /clients/:id con otherCredits (aditivo)', () => {
  it('entrega la ficha intacta y el campo nuevo no rompe nada de lo que el móvil lee', async () => {
    mockApi.res = {
      status: 'ok',
      data: {
        id: 'cl-1',
        clientType: 'PERSON',
        firstName: 'Ana',
        lastName: 'Ruiz',
        status: 'ACTIVE',
        contacts: [{ id: 'ct-1', contactType: 'PHONE', value: '7****23', isPrimary: true }],
        otherCredits: { count: 2, totalOutstanding: 1500, responsibles: [{ userId: 'u1', name: 'Ana Rojas' }] },
      },
    };
    const res = await getClient('cl-1');
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;
    expect(res.data.firstName).toBe('Ana');
    expect(res.data.contacts?.[0]?.value).toBe('7****23');
  });

  it('el móvil no declara ni usa otherCredits todavía (F8)', () => {
    const { readFileSync } = jest.requireActual('fs') as typeof import('fs');
    const { join } = jest.requireActual('path') as typeof import('path');
    expect(readFileSync(join(__dirname, 'clients.service.ts'), 'utf8')).not.toContain('otherCredits');
  });
});

describe('acción encolada sobre un cliente que dejó de ser visible', () => {
  it('el 404 es un rechazo PERMANENTE: se descarta de la cola en vez de reintentarse para siempre', () => {
    const { isPermanentRejection } = jest.requireActual('./sync/queue') as typeof import('./sync/queue');
    expect(isPermanentRejection(404)).toBe(true);
    expect(isPermanentRejection(403)).toBe(true);
    // Lo que sí se reintenta: sin señal, tiempo agotado y límite de peticiones.
    expect(isPermanentRejection(undefined)).toBe(false);
    expect(isPermanentRejection(408)).toBe(false);
    expect(isPermanentRejection(429)).toBe(false);
  });
});
