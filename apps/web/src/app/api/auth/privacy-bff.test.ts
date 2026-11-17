// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest';

const { cookieStore, apiCall } = vi.hoisted(() => ({
  cookieStore: new Map<string, string>(),
  apiCall: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: () => ({ get: (n: string) => (cookieStore.has(n) ? { value: cookieStore.get(n) } : undefined) }),
}));
vi.mock('@/lib/bff', async (orig) => ({ ...(await orig<typeof import('@/lib/bff')>()), apiCall }));

import { GET as mine, POST as create } from '../privacy/requests/route';
import { GET as orgList, POST as orgCreate } from '../privacy/requests/org/route';
import { PATCH as orgStatus } from '../privacy/requests/org/[id]/status/route';

const ID = '11111111-1111-1111-1111-111111111111';
const ok = (data: unknown) => ({ status: 200, body: { data, error: null, meta: {} } });
const json = (method: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request('http://localhost/api/privacy/requests', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  cookieStore.clear();
  apiCall.mockReset();
  apiCall.mockResolvedValue(ok({ id: ID }));
});

describe('BFF · solicitudes de derechos', () => {
  it('🔴 la lectura propia usa la sesión y no se cachea; la persona nunca se manda desde el navegador', async () => {
    apiCall.mockResolvedValue(ok([]));
    const res = await mine();
    const [path, init] = apiCall.mock.calls[0]!;
    expect(path).toBe('/privacy/requests/mine');
    expect(init.auth).toBe(true);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('🔴 presentar una solicitud transporta SOLO tipo y descripción: cualquier otro campo (userId, accountId, status…) se descarta', async () => {
    const res = await create(json('POST', { type: 'ACCESS', description: 'Quiero acceso a mis datos', userId: 'otro', accountId: 'x', status: 'COMPLETED', subjectKind: 'DEBTOR_VIA_ORG' }));
    expect(res.status).toBe(201);
    const [path, init] = apiCall.mock.calls[0]!;
    expect(path).toBe('/privacy/requests');
    expect(init.auth).toBe(true);
    expect(JSON.parse(init.body)).toEqual({ type: 'ACCESS', description: 'Quiero acceso a mis datos' });
  });

  it('rechaza un origen distinto (CSRF) sin llegar a la API', async () => {
    const res = await create(json('POST', { type: 'ACCESS', description: 'x'.repeat(20) }, { origin: 'https://malo.example' }));
    expect(res.status).toBe(403);
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('un cuerpo `null` no tumba el handler: la API responde su error y llega tal cual', async () => {
    apiCall.mockResolvedValue({ status: 400, body: { data: null, error: { code: 'VALIDATION_ERROR', message: 'x' }, meta: {} } });
    const res = await create(new Request('http://localhost/api/privacy/requests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'null' }));
    expect(res.status).toBe(400);
  });

  it('el registro de la organización transporta el titular y va a la ruta /org', async () => {
    await orgCreate(json('POST', { type: 'ERASURE', subjectLabel: 'Juan Pérez', description: 'Pide eliminar su contacto', accountId: 'otra' }));
    const [path, init] = apiCall.mock.calls[0]!;
    expect(path).toBe('/privacy/requests/org');
    expect(JSON.parse(init.body)).toEqual({ type: 'ERASURE', subjectLabel: 'Juan Pérez', description: 'Pide eliminar su contacto' });
  });

  it('el listado de la organización lo pide con la sesión (el permiso lo valida la API)', async () => {
    apiCall.mockResolvedValue(ok([]));
    await orgList();
    expect(apiCall.mock.calls[0]![0]).toBe('/privacy/requests/org');
    expect(apiCall.mock.calls[0]![1].auth).toBe(true);
  });

  it('el cambio de estado transporta estado, nota y justificación, y descarta lo demás', async () => {
    const res = await orgStatus(json('PATCH', { status: 'REJECTED', rejectionReason: 'Obligación legal', note: 'n', closedAt: 'hoy', events: [] }), { params: { id: ID } });
    expect(res.status).toBe(200);
    const [path, init] = apiCall.mock.calls[0]!;
    expect(path).toBe(`/privacy/requests/org/${ID}/status`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ status: 'REJECTED', note: 'n', rejectionReason: 'Obligación legal' });
  });

  it('🔴 un id que no es un uuid no llega a la API (400)', async () => {
    for (const id of ['../x', 'abc', `${ID}/../..`]) {
      expect((await orgStatus(json('PATCH', { status: 'IN_REVIEW' }), { params: { id } })).status, id).toBe(400);
    }
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('un error de la API (p. ej. 409 de transición inválida) llega con su código', async () => {
    apiCall.mockResolvedValue({ status: 409, body: { data: null, error: { code: 'PRIVACY_REQUEST_INVALID_TRANSITION', message: 'x' }, meta: {} } });
    const res = await orgStatus(json('PATCH', { status: 'COMPLETED' }), { params: { id: ID } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PRIVACY_REQUEST_INVALID_TRANSITION');
  });
});
