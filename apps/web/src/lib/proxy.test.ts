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

  it('🔴 un 204 también es éxito: «hecho, no hay nada que devolver»', async () => {
    /*
     * Los borrados de la API contestan 204 sin cuerpo. Exigir `data` los convertía en un 400: la
     * parada se borraba de verdad y la pantalla decía que no se pudo. Se vio en un smoke, no en un
     * test — el servidor había hecho su trabajo, así que sólo aparecía mirando las dos cosas juntas.
     */
    server.use(http.delete(`${API}/routes/r1/stops/s1`, () => new HttpResponse(null, { status: 204 })));

    const req = new Request('http://localhost/api/routes/r1/stops/s1', { method: 'DELETE' });
    const res = await proxyMutation(req, '/routes/r1/stops/s1', 'DELETE');

    expect(res.status).toBe(204);
  });

  it('un 2xx con el cuerpo vacío SIGUE siendo un error: prometió datos y no los mandó', async () => {
    // Distinto del 204: ahí el contrato es «sin cuerpo». Un 200 vacío es una respuesta rota.
    server.use(http.post(`${API}/cases/c1/assign`, () => HttpResponse.json({ data: null, error: null, meta: {} })));

    const res = await proxyMutation(post({ collectorId: 'u9' }), '/cases/c1/assign');
    expect(res.status).toBeGreaterThanOrEqual(400);
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

  it('🔴 reenvía el Idempotency-Key COMO HEADER', async () => {
    /*
     * `POST /payments` lo lee del header y no del cuerpo, y `apiCall` arma los suyos: sin
     * reenviarlo, la clave se pierde acá y un doble clic registra el pago DOS veces, sobre un
     * ledger que la API no deja corregir ni anular.
     */
    let seen: string | null = null;
    server.use(
      http.post(`${API}/payments`, ({ request }) => {
        seen = request.headers.get('idempotency-key');
        return HttpResponse.json({ data: { id: 'p1' }, error: null, meta: {} }, { status: 201 });
      }),
    );

    const req = new Request('http://localhost/api/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'clave-del-formulario' },
      body: JSON.stringify({ creditId: 'c1', amount: 100, method: 'CASH' }),
    });
    await proxyMutation(req, '/payments', 'POST', ['idempotency-key']);

    expect(seen).toBe('clave-del-formulario');
  });

  it('sólo reenvía los headers que se le piden, no todo lo que trae el navegador', async () => {
    let cookie: string | null = null;
    server.use(
      http.post(`${API}/payments`, ({ request }) => {
        cookie = request.headers.get('cookie');
        return HttpResponse.json({ data: { id: 'p1' }, error: null, meta: {} }, { status: 201 });
      }),
    );

    const req = new Request('http://localhost/api/payments', {
      method: 'POST',
      headers: { cookie: 'k_access=secreto', 'idempotency-key': 'x' },
      body: '{}',
    });
    await proxyMutation(req, '/payments', 'POST', ['idempotency-key']);

    // Las cookies del panel no son las de la API: quien autentica es el Bearer que pone `apiCall`.
    expect(cookie).toBeNull();
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
