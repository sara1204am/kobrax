/**
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'access-token' }) }),
}));

const { GET } = await import('./route');

const API = 'http://127.0.0.1:4010/api';
const req = new Request('http://localhost/api/exports/x');

describe('GET /api/exports/[type]', () => {
  it('F4/08 · `mora` se reenvía a /exports/mora con el Content-Disposition', async () => {
    server.use(
      http.get(`${API}/exports/mora`, () =>
        new HttpResponse('a,b', { headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="mora.csv"' } }),
      ),
    );
    const res = await GET(req, { params: { type: 'mora' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('mora.csv');
  });

  it('`cases` ya no se reenvía (F4/08: el caso no existe)', async () => {
    expect((await GET(req, { params: { type: 'cases' } })).status).toBe(404);
  });

  it('🔴 un tipo que la API no expone no se reenvía', async () => {
    expect((await GET(req, { params: { type: '../users' } })).status).toBe(404);
  });
});
