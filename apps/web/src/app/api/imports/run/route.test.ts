/**
 * @vitest-environment node
 *
 * Un route handler corre en el servidor, y el `FormData` de jsdom no es el que entiende el
 * `Request` de Node: mezclarlos deja el `req.formData()` colgado sin error. El entorno `node`
 * usa los mismos globals que Next en producción.
 */
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';

// El handler lee el access token de la cookie httpOnly; fuera de Next no hay request store.
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'access-token' }) }),
}));

const { POST } = await import('./route');

const API = 'http://127.0.0.1:4010/api/imports/portfolio';

function upload(url: string, dryRun: boolean): Request {
  const form = new FormData();
  form.set('file', new File(['codigo;nombre'], 'cartera.csv', { type: 'text/csv' }));
  if (dryRun) form.set('dryRun', 'true');
  return new Request(url, { method: 'POST', body: form });
}

describe('POST /api/imports/run', () => {
  it('manda dryRun COMO CAMPO del multipart y nunca por query', async () => {
    let seen: { query: string | null; dryRun: FormDataEntryValue | null; file: string } | null = null;
    server.use(
      http.post(API, async ({ request }) => {
        const form = await request.formData();
        seen = {
          query: new URL(request.url).searchParams.get('dryRun'),
          dryRun: form.get('dryRun'),
          file: (form.get('file') as File).name,
        };
        return HttpResponse.json({ data: { dryRun: true, idempotentSkip: false }, error: null, meta: {} });
      }),
    );

    const res = await POST(upload('http://localhost/api/imports/run', true));

    expect(res.status).toBe(200);
    // Confundirlos importa de verdad creyendo que previsualiza: es el error más caro de W4.
    expect(seen).toEqual({ query: null, dryRun: 'true', file: 'cartera.csv' });
  });

  it('reenvía columnsOnly COMO QUERY', async () => {
    let query: string | null = null;
    server.use(
      http.post(API, ({ request }) => {
        query = new URL(request.url).searchParams.get('columnsOnly');
        return HttpResponse.json({ data: { labels: [] }, error: null, meta: {} });
      }),
    );

    await POST(upload('http://localhost/api/imports/run?columnsOnly=true', false));

    expect(query).toBe('true');
  });

  it('con la API caída responde 502 y no revienta', async () => {
    server.use(http.post(API, () => HttpResponse.error()));

    const res = await POST(upload('http://localhost/api/imports/run', true));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: { code: 'API_UNREACHABLE', message: expect.any(String) } });
  });

  it('propaga el error del servidor con su código', async () => {
    server.use(
      http.post(API, () =>
        HttpResponse.json(
          { data: null, error: { code: 'FILE_SHAPE_MISMATCH', message: 'El archivo no es un PDF' }, meta: {} },
          { status: 400 },
        ),
      ),
    );

    const res = await POST(upload('http://localhost/api/imports/run', true));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('FILE_SHAPE_MISMATCH');
  });

  it('rechaza el origen cruzado antes de tocar la API', async () => {
    const req = new Request('http://localhost/api/imports/run', {
      method: 'POST',
      headers: { origin: 'http://malicioso.example', host: 'localhost' },
      body: new FormData(),
    });

    // Sin `server.use`: si el handler llamara a la API, MSW rompería por request no manejado.
    expect((await POST(req)).status).toBe(403);
  });
});
