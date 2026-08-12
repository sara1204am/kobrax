/**
 * @vitest-environment node
 *
 * Un route handler corre en el servidor: se prueba con los globals de Node, no con los de jsdom.
 */
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'access-token' }) }),
}));

const { proxyMutation } = await import('./proxy');

const API = 'http://127.0.0.1:4010/api';

const post = (body?: unknown) =>
  new Request('http://localhost/api/cases/c1/assign', {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });

describe('proxyMutation', () => {
  it('🔴 un 201 es éxito, no un error', async () => {
    // Los controllers de casos y agenda no llevan `@HttpCode`, así que sus POST responden 201.
    // Exigir 200 convertía toda respuesta buena de esos módulos en un error sin mensaje.
    server.use(
      http.post(`${API}/cases/c1/assign`, () =>
        HttpResponse.json({ data: { id: 'c1', assigneeId: 'u9' }, error: null, meta: {} }, { status: 201 }),
      ),
    );

    const res = await proxyMutation(post({ collectorId: 'u9' }), '/cases/c1/assign');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'c1', assigneeId: 'u9' });
  });

  it('reenvía el cuerpo tal cual llegó', async () => {
    let seen: unknown;
    server.use(
      http.post(`${API}/cases/c1/assign`, async ({ request }) => {
        seen = await request.json();
        return HttpResponse.json({ data: { id: 'c1' }, error: null, meta: {} }, { status: 201 });
      }),
    );

    await proxyMutation(post({ auto: true }), '/cases/c1/assign');

    expect(seen).toEqual({ auto: true });
  });

  it('sin cuerpo no manda un cuerpo vacío que el DTO tendría que interpretar', async () => {
    let hadBody: boolean | undefined;
    server.use(
      http.post(`${API}/cases/c1/assign`, async ({ request }) => {
        hadBody = (await request.text()).length > 0;
        return HttpResponse.json({ data: { id: 'c1' }, error: null, meta: {} }, { status: 201 });
      }),
    );

    await proxyMutation(post(), '/cases/c1/assign');

    expect(hadBody).toBe(false);
  });

  it('propaga el error del servidor con su código y su status', async () => {
    server.use(
      http.post(`${API}/cases/c1/assign`, () =>
        HttpResponse.json(
          { data: null, error: { code: 'CASE_002', message: 'Cambio de estado no permitido' }, meta: {} },
          { status: 400 },
        ),
      ),
    );

    const res = await proxyMutation(post({}), '/cases/c1/assign');

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('CASE_002');
  });

  it('con la API caída responde y no revienta el handler', async () => {
    server.use(http.post(`${API}/cases/c1/assign`, () => HttpResponse.error()));

    const res = await proxyMutation(post({}), '/cases/c1/assign');

    // `apiCall` devuelve `status: 0` en vez de tirar; `apiError` lo lleva a 400 con su código.
    expect((await res.json()).error.code).toBe('API_UNREACHABLE');
  });

  it('rechaza el origen cruzado antes de tocar la API', async () => {
    const req = new Request('http://localhost/api/cases/c1/assign', {
      method: 'POST',
      headers: { origin: 'http://malicioso.example', host: 'localhost' },
    });

    // Sin `server.use`: si llamara a la API, MSW rompería por request no manejado.
    expect((await proxyMutation(req, '/cases/c1/assign')).status).toBe(403);
  });
});
