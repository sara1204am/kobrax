/**
 * @vitest-environment node
 *
 * Un route handler corre en el servidor: el entorno `node` usa los mismos globals que Next en
 * producción. Con jsdom, `Request`/`Response` no son los mismos y el handler falla por donde no es.
 */
import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '@/test/msw-server';

vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'access-token' }) }),
}));

const { POST } = await import('./route');

const API = 'http://127.0.0.1:4010/api';
const ANA = '11111111-1111-1111-1111-111111111111';
const JUAN = '22222222-2222-2222-2222-222222222222';

function pedir(body: unknown): Request {
  return new Request('http://localhost/api/routes/plan', {
    method: 'POST',
    headers: { origin: 'http://localhost', host: 'localhost' },
    body: JSON.stringify(body),
  });
}

/** La API de mentira: rutas ya existentes, casos por cobrador, y qué se intentó crear. */
function api(opts: { existing?: string[]; cases?: Record<string, number>; fail?: string } = {}) {
  const created: { collectorId: string; caseIds: string[]; plannedDate: string }[] = [];

  server.use(
    http.get(`${API}/routes`, () =>
      HttpResponse.json({
        data: (opts.existing ?? []).map((collectorId) => ({ id: `r-${collectorId}`, collectorId })),
        error: null,
        meta: {},
      }),
    ),
    http.get(`${API}/cases`, ({ request }) => {
      const url = new URL(request.url);
      const who = url.searchParams.get('assigneeId') ?? '';
      const limit = Number(url.searchParams.get('limit')) || 0;
      const n = Math.min(opts.cases?.[who] ?? 0, limit);
      return HttpResponse.json({
        data: Array.from({ length: n }, (_, i) => ({ id: `${who}-caso-${i}` })),
        error: null,
        meta: {},
      });
    }),
    http.post(`${API}/routes/generate`, async ({ request }) => {
      const body = (await request.json()) as { collectorId: string; caseIds: string[]; plannedDate: string };
      if (opts.fail === body.collectorId) {
        return HttpResponse.json(
          { data: null, error: { code: 'ROUTE_EMPTY', message: 'No tenés casos abiertos' }, meta: {} },
          { status: 422 },
        );
      }
      created.push(body);
      return HttpResponse.json({ data: { id: 'nueva' }, error: null, meta: {} }, { status: 201 });
    }),
  );

  return created;
}

describe('POST /api/routes/plan', () => {
  it('arma una ruta por cobrador con sus casos, hasta el tope de paradas', async () => {
    const created = api({ cases: { [ANA]: 20, [JUAN]: 3 } });

    const res = await POST(pedir({ plannedDate: '2026-08-25', collectorIds: [ANA, JUAN], stopsPerRoute: 8 }));
    const body = (await res.json()) as { rows: { collectorId: string; stops: number; created?: boolean }[] };

    expect(res.status).toBe(200);
    // Ana tiene veinte casos abiertos pero la jornada son ocho: el tope manda.
    expect(body.rows).toEqual([
      { collectorId: ANA, stops: 8, created: true },
      { collectorId: JUAN, stops: 3, created: true },
    ]);
    expect(created).toHaveLength(2);
    expect(created[0]!.caseIds).toHaveLength(8);
    expect(created[0]!.plannedDate).toBe('2026-08-25');
  });

  it('🔴 con `dryRun` no crea NADA, y devuelve exactamente lo mismo', async () => {
    // Es lo que hace que la revisión previa valga: muestra lo que se va a crear porque recorre el
    // mismo camino, no una cuenta parecida hecha en otro lado.
    const created = api({ cases: { [ANA]: 12 } });

    const res = await POST(pedir({ plannedDate: '2026-08-25', collectorIds: [ANA], dryRun: true }));
    const body = (await res.json()) as { rows: { stops: number; created?: boolean }[] };

    expect(body.rows[0]).toEqual({ collectorId: ANA, stops: 8 }); // el default de paradas
    expect(created).toHaveLength(0);
  });

  it('🔴 a quien YA tiene ruta ese día no se le crea otra', async () => {
    // La base lo impide con un unique; si el aviso no estuviera acá, la persona se enteraría con un
    // 422 recién al publicar, después de haber revisado una planificación que prometía la ruta.
    const created = api({ existing: [ANA], cases: { [ANA]: 10, [JUAN]: 10 } });

    const res = await POST(pedir({ plannedDate: '2026-08-25', collectorIds: [ANA, JUAN] }));
    const body = (await res.json()) as { rows: { collectorId: string; alreadyHasRoute?: boolean; created?: boolean }[] };

    expect(body.rows[0]).toMatchObject({ collectorId: ANA, alreadyHasRoute: true });
    expect(body.rows[0]!.created).toBeUndefined();
    expect(created.map((c) => c.collectorId)).toEqual([JUAN]);
  });

  it('sin casos abiertos no se arma una ruta vacía', async () => {
    const created = api({ cases: { [ANA]: 0 } });
    const res = await POST(pedir({ plannedDate: '2026-08-25', collectorIds: [ANA] }));
    const body = (await res.json()) as { rows: { stops: number; created?: boolean }[] };

    expect(body.rows[0]!.stops).toBe(0);
    expect(created).toHaveLength(0);
  });

  it('🔴 si una falla, las demás se crean igual y se dice cuál no entró', async () => {
    // No es atómico —la API no ofrece nada que lo sea—, así que cortar en la primera dejaría media
    // planificación hecha sin decir dónde quedó.
    const created = api({ cases: { [ANA]: 5, [JUAN]: 5 }, fail: ANA });

    const res = await POST(pedir({ plannedDate: '2026-08-25', collectorIds: [ANA, JUAN] }));
    const body = (await res.json()) as { rows: { collectorId: string; error?: string; created?: boolean }[] };

    expect(body.rows[0]!.error).toBe('No tenés casos abiertos');
    expect(body.rows[1]!.created).toBe(true);
    expect(created.map((c) => c.collectorId)).toEqual([JUAN]);
  });

  it('una fecha inventada o sin cobradores no llega a la API', async () => {
    const created = api({ cases: { [ANA]: 5 } });
    expect((await POST(pedir({ plannedDate: 'mañana', collectorIds: [ANA] }))).status).toBe(400);
    expect((await POST(pedir({ plannedDate: '2026-08-25', collectorIds: [] }))).status).toBe(400);
    expect(created).toHaveLength(0);
  });
});
