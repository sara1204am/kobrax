/**
 * @vitest-environment node
 *
 * Un route handler corre en el servidor: el entorno `node` usa los mismos globals que Next.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'access-token' }) }),
}));

const { GET, PUT } = await import('./route');

const API = 'http://127.0.0.1:4010/api';

function put(body: unknown, origin = 'http://localhost') {
  return new Request('http://localhost/api/arrear-categories', {
    method: 'PUT',
    headers: { 'content-type': 'application/json', origin, host: 'localhost' },
    body: JSON.stringify(body),
  });
}

describe('BFF /api/arrear-categories', () => {
  beforeEach(() => {
    server.use(
      http.get(`${API}/arrear-categories`, () => HttpResponse.json({ data: [{ code: 'A' }], error: null, meta: {} })),
    );
  });

  it('GET devuelve los rangos', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [{ code: 'A' }] });
  });

  it('🔴 PUT sin el mismo origen es 403 y no llega a la API', async () => {
    let llamado = false;
    server.use(
      http.put(`${API}/arrear-categories`, () => {
        llamado = true;
        return HttpResponse.json({ data: [] });
      }),
    );
    const res = await PUT(put({ categories: [] }, 'http://evil.example'));
    expect(res.status).toBe(403);
    expect(llamado).toBe(false);
  });

  it('PUT reenvía el cuerpo tal cual', async () => {
    let recibido: unknown;
    server.use(
      http.put(`${API}/arrear-categories`, async ({ request }) => {
        recibido = await request.json();
        return HttpResponse.json({ data: [{ code: 'A' }], error: null, meta: {} });
      }),
    );
    const cuerpo = { categories: [{ code: 'A', name: 'A', fromDays: 1, toDays: null, color: null }] };
    const res = await PUT(put(cuerpo));
    expect(res.status).toBe(200);
    expect(recibido).toEqual(cuerpo);
  });

  it('PUT propaga el 400 ARREAR_CATEGORIES_INVALID', async () => {
    server.use(
      http.put(`${API}/arrear-categories`, () =>
        HttpResponse.json(
          { data: null, error: { code: 'ARREAR_CATEGORIES_INVALID', message: 'inválido' }, meta: {} },
          { status: 400 },
        ),
      ),
    );
    const res = await PUT(put({ categories: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('ARREAR_CATEGORIES_INVALID');
  });
});
