import { apiFetch, publicCall } from './api';
import { LEGAL_SLUG, getLegalDocument, getSignupDocuments } from './legal.service';
import { acceptInvitation } from './users.service';
import { signup } from './account.service';

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

/** Un `fetch` que devuelve un sobre de la API y deja ver la URL y el cuerpo con que se llamó. */
function stub(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { status, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe('publicCall · el código de error llega a la pantalla', () => {
  it('🔴 conserva el code de la API (la pantalla decide con él, no con el texto)', async () => {
    stub(409, { data: null, error: { code: 'LEGAL_VERSION_STALE', message: 'Los documentos cambiaron' } });
    const res = await publicCall('/accounts', { method: 'POST', body: {} });
    expect(res).toEqual({ status: 'error', message: 'Los documentos cambiaron', code: 'LEGAL_VERSION_STALE' });
  });

  it('sin code no agrega la clave (los errores de siempre quedan idénticos)', async () => {
    stub(400, { data: null, error: { message: 'Algo falló' } });
    const res = await publicCall('/accounts', { method: 'POST', body: {} });
    expect(res).toEqual({ status: 'error', message: 'Algo falló' });
  });
});

describe('legal.service', () => {
  it('pide las versiones vigentes en español, sin sesión', async () => {
    const calls = stub(200, { data: [{ type: 'TERMS' }], error: null });
    const res = await getSignupDocuments();
    expect(res.status).toBe('ok');
    expect(calls[0]!.url).toContain('/legal/signup-documents?locale=es');
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('🔴 pide la versión EXACTA que se va a aceptar (lo que se lee es lo que se acepta) y codifica el slug y la versión', async () => {
    const calls = stub(200, { data: { id: 'x', content: 'Texto' }, error: null });
    await getLegalDocument(LEGAL_SLUG.TERMS, '1.0.0+b1');
    expect(calls[0]!.url).toContain('/legal/documents/terms/versions/1.0.0%2Bb1?locale=es');
  });

  it('manda siempre x-client-type: mobile, para que la evidencia del alta quede como «registro en la app»', async () => {
    const calls = stub(200, { data: [], error: null });
    await apiFetch('/legal/signup-documents');
    expect((calls[0]!.init?.headers as Record<string, string>)['x-client-type']).toBe('mobile');
  });

  it('el contenido del documento no se interpreta: llega tal cual (datos, no HTML)', async () => {
    stub(200, { data: { id: 'x', content: '<script>alert(1)</script>' }, error: null });
    const res = await getLegalDocument('terms', '1.0.0');
    expect(res.status === 'ok' && res.data.content).toBe('<script>alert(1)</script>');
  });
});

describe('el alta y la invitación llevan los ids de lo aceptado', () => {
  it('🔴 signup() envía termsVersionId y privacyVersionId dentro del cuerpo', async () => {
    const calls = stub(201, { data: { accountId: 'a1' }, error: null });
    await signup({
      businessName: 'Cobranzas',
      firstName: 'Ana',
      lastName: 'Pérez',
      email: 'a@b.co',
      password: 'Kobrax123!',
      termsVersionId: 't-1',
      privacyVersionId: 'p-1',
    });
    expect(calls[0]!.url).toContain('/accounts');
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body).toMatchObject({ termsVersionId: 't-1', privacyVersionId: 'p-1' });
    // Nunca un texto ni un hash.
    expect(JSON.stringify(body)).not.toMatch(/sha256|content/i);
  });

  it('🔴 acceptInvitation() envía los ids junto al código y la contraseña', async () => {
    const calls = stub(200, { data: { email: 'a@b.co' }, error: null });
    await acceptInvitation('K7F29-QX3TM', 'Kobrax123!', { termsVersionId: 't-1', privacyVersionId: 'p-1' });
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      code: 'K7F29-QX3TM',
      password: 'Kobrax123!',
      termsVersionId: 't-1',
      privacyVersionId: 'p-1',
    });
  });

  it('sin aceptación (llamada vieja) no inventa ids: la API responderá 422', async () => {
    const calls = stub(200, { data: { email: 'a@b.co' }, error: null });
    await acceptInvitation('K7F29-QX3TM', 'Kobrax123!');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ code: 'K7F29-QX3TM', password: 'Kobrax123!' });
  });
});
