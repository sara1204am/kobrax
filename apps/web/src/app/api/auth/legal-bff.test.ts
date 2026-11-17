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

import { POST as registro } from './registro/route';
import { POST as invitacion } from './invitacion/route';
import { GET as signupDocuments } from '../legal/signup-documents/route';
import { GET as legalDocument } from '../legal/documents/[slug]/route';

const post = (body: unknown) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ok = (data: unknown) => ({ status: 200, body: { data, error: null, meta: {} } });

const ALTA = { businessName: 'Cobranzas', firstName: 'Ana', lastName: 'Pérez', email: 'a@b.co', password: 'Kobrax123!', planCode: 'FREE' };

beforeEach(() => {
  cookieStore.clear();
  apiCall.mockReset();
  apiCall.mockResolvedValue(ok({ accountId: 'acc-1', email: 'a@b.co' }));
});

/**
 * El BFF arma el cuerpo campo por campo: un campo que no se nombre se pierde en silencio y la API respondería
 * `LEGAL_ACCEPTANCE_REQUIRED` aunque la persona sí lo haya marcado. Estos tests fijan que la aceptación viaja completa.
 */
describe('BFF · la aceptación legal viaja a la API', () => {
  it('🔴 el registro transporta los ids de versión y los consentimientos opcionales', async () => {
    await registro(post({ ...ALTA, termsVersionId: 't-1', privacyVersionId: 'p-1', marketingOptIn: true, analyticsOptIn: false }));
    const [path, init] = apiCall.mock.calls[0]!;
    expect(path).toBe('/accounts');
    expect(JSON.parse(init.body)).toMatchObject({
      termsVersionId: 't-1',
      privacyVersionId: 'p-1',
      marketingOptIn: true,
      analyticsOptIn: false,
      planCode: 'FREE',
    });
  });

  it('el registro sin aceptación NO la inventa: no manda ids, y la API es quien responde 422', async () => {
    await registro(post(ALTA));
    const body = JSON.parse(apiCall.mock.calls[0]![1].body);
    expect(body.termsVersionId).toBeUndefined();
    expect(body.privacyVersionId).toBeUndefined();
    expect(body.marketingOptIn).toBeUndefined();
  });

  it('el error de la API (p. ej. versión vencida) llega a la pantalla con su código', async () => {
    apiCall.mockResolvedValue({
      status: 409,
      body: { data: null, error: { code: 'LEGAL_VERSION_STALE', message: 'cambiaron' }, meta: {} },
    });
    const res = await registro(post({ ...ALTA, termsVersionId: 't-1', privacyVersionId: 'p-1' }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('LEGAL_VERSION_STALE');
  });

  it('🔴 la invitación transporta los ids de versión y el marketing', async () => {
    apiCall.mockResolvedValue(ok({ email: 'a@b.co' }));
    await invitacion(post({ code: 'K7F29-QX3TM', password: 'Kobrax123!', termsVersionId: 't-1', privacyVersionId: 'p-1', marketingOptIn: true }));
    const [path, init] = apiCall.mock.calls[0]!;
    expect(path).toBe('/auth/invitation/accept');
    expect(JSON.parse(init.body)).toMatchObject({ code: 'K7F29-QX3TM', termsVersionId: 't-1', privacyVersionId: 'p-1', marketingOptIn: true });
  });

  it('la lectura pública de los documentos pide siempre español y no se cachea', async () => {
    apiCall.mockResolvedValue(ok([{ type: 'TERMS', versionId: 't-1' }]));
    const res = await signupDocuments();
    expect(apiCall.mock.calls[0]![0]).toBe('/legal/signup-documents?locale=es');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual([{ type: 'TERMS', versionId: 't-1' }]);
  });

  it('si la API no tiene documentos publicados (404) lo informa y no inventa nada', async () => {
    apiCall.mockResolvedValue({
      status: 404,
      body: { data: null, error: { code: 'LEGAL_DOCUMENT_NOT_FOUND', message: 'No hay una versión publicada' }, meta: {} },
    });
    const res = await signupDocuments();
    expect(res.status).toBe(404);
  });
});

describe('BFF · lectura de un documento legal', () => {
  const get = (slug: string, qs = '') =>
    legalDocument(new Request(`http://localhost/api/legal/documents/${slug}${qs}`), { params: { slug } });

  it('sin versión pide la vigente, siempre en español y sin caché', async () => {
    apiCall.mockResolvedValue(ok({ version: '1.0.0', content: 'x' }));
    const res = await get('terms');
    expect(apiCall.mock.calls[0]![0]).toBe('/legal/documents/terms/current?locale=es');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('con ?version= pide esa versión EXACTA (lo que se lee es lo que se acepta)', async () => {
    apiCall.mockResolvedValue(ok({ version: '1.0.0', content: 'x' }));
    await get('privacy', '?version=1.0.0');
    expect(apiCall.mock.calls[0]![0]).toBe('/legal/documents/privacy/versions/1.0.0?locale=es');
  });

  it('🔴 un slug o una versión con caracteres raros se rechaza (400) y nunca llega a la API', async () => {
    for (const [slug, qs] of [
      ['../auth/login', ''],
      ['terms/../x', ''],
      ['TERMS', ''],
      ['terms', '?version=../../x'],
      ['terms', '?version=1.0.0/..%2fauth'],
      ['terms', '?version=%20'],
    ] as const) {
      const res = await get(slug, qs);
      expect(res.status, `${slug}${qs}`).toBe(400);
    }
    expect(apiCall).not.toHaveBeenCalled();
  });

  it('si la API no tiene esa versión, el 404 llega tal cual', async () => {
    apiCall.mockResolvedValue({ status: 404, body: { data: null, error: { code: 'LEGAL_DOCUMENT_NOT_FOUND', message: 'No hay' }, meta: {} } });
    expect((await get('terms', '?version=9.9.9')).status).toBe(404);
  });
});
