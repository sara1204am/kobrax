/**
 * @vitest-environment node
 *
 * Un route handler corre en el servidor: el entorno `node` usa los mismos globals que Next en producción.
 */
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'access-token' }) }),
}));

const { POST } = await import('./route');

const API = 'http://127.0.0.1:4010/api';
const C1 = '11111111-1111-1111-1111-111111111111';
const C2 = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

function pedir(body: unknown): Request {
  return new Request('http://localhost/api/mora/bulk', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mora/bulk — por creditIds, sin casos', () => {
  it('🔴 reasignar es UNA llamada a /assignments/bulk y devuelve cuántos cambiaron y por qué se saltó el resto', async () => {
    const seen: unknown[] = [];
    server.use(
      http.post(`${API}/assignments/bulk`, async ({ request }) => {
        seen.push(await request.json());
        return HttpResponse.json({ data: { changed: 1, skipped: [{ creditId: C2, reason: 'OUT_OF_AGENCY' }] }, error: null, meta: {} });
      }),
    );
    const res = await POST(pedir({ action: 'assign', creditIds: [C1, C2], userId: USER }));
    expect(seen).toEqual([{ creditIds: [C1, C2], userId: USER }]);
    expect(await res.json()).toEqual({ done: 1, failed: 1, message: 'OUT_OF_AGENCY' });
  });

  it('reasignar sin elegir al cobrador es un 400: ya no existe «al de menor carga»', async () => {
    const res = await POST(pedir({ action: 'assign', creditIds: [C1] }));
    expect(res.status).toBe(400);
  });

  it('la prioridad es un PATCH por crédito; «auto» la suelta con null', async () => {
    const calls: { id: string; body: unknown }[] = [];
    server.use(
      http.patch(`${API}/mora/:id/priority`, async ({ request, params }) => {
        calls.push({ id: String(params.id), body: await request.json() });
        return HttpResponse.json({ data: {}, error: null, meta: {} });
      }),
    );
    const fija = await POST(pedir({ action: 'priority', creditIds: [C1, C2], priority: 'HIGH' }));
    expect(await fija.json()).toEqual({ done: 2, failed: 0 });
    await POST(pedir({ action: 'priority', creditIds: [C1], priority: 'auto' }));
    expect(calls).toEqual([
      { id: C1, body: { priority: 'HIGH' } },
      { id: C2, body: { priority: 'HIGH' } },
      { id: C1, body: { priority: null } },
    ]);
  });

  it('poner al día va directo a /credits/:id/arrears/clear, sin leer ningún caso, y cuenta los fallos', async () => {
    const calls: string[] = [];
    server.use(
      http.post(`${API}/credits/:id/arrears/clear`, ({ params }) => {
        calls.push(String(params.id));
        return params.id === C2
          ? HttpResponse.json({ data: null, error: { code: 'X', message: 'No se pudo' }, meta: {} }, { status: 400 })
          : HttpResponse.json({ data: {}, error: null, meta: {} });
      }),
    );
    const res = await POST(pedir({ action: 'clear', creditIds: [C1, C2], mode: 'next_period' }));
    expect(calls).toEqual([C1, C2]);
    expect(await res.json()).toEqual({ done: 1, failed: 1, message: 'No se pudo' });
  });

  it('rechaza ids que no son uuid y lotes vacíos o demasiado grandes', async () => {
    expect((await POST(pedir({ action: 'clear', creditIds: ['../users'] }))).status).toBe(400);
    expect((await POST(pedir({ action: 'clear', creditIds: [] }))).status).toBe(400);
    const muchos = Array.from({ length: 101 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    expect((await POST(pedir({ action: 'clear', creditIds: muchos }))).status).toBe(400);
  });
});
