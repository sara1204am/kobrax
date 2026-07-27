import { apiFetch } from './api';

/**
 * Regresión del splash clavado: la app se quedaba en la pantalla de arranque para siempre cuando
 * la API aceptaba la conexión y no contestaba (docker caído a medias, IP de LAN vieja, firewall).
 * `routeAfterAuth` esperaba un `fetch` que nunca terminaba. Nadie veía un error: sólo el logo.
 */
describe('apiFetch — techo de espera', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('una API que nunca contesta cae en offline, no cuelga el arranque', async () => {
    jest.useFakeTimers();
    // Se resuelve sólo si abortan la señal: es exactamente el caso "conectó y se quedó mudo".
    global.fetch = jest.fn((_url: string, init?: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    const pending = apiFetch('/auth/me');
    jest.advanceTimersByTime(15_000);

    expect(await pending).toEqual({
      status: 0,
      data: null,
      error: { code: 'NETWORK', message: 'Sin conexión' },
    });
  });

  it('una respuesta normal no espera al reloj', async () => {
    global.fetch = jest.fn(async () => ({
      status: 200,
      json: async () => ({ data: { ok: 1 }, error: null }),
    })) as unknown as typeof fetch;

    expect(await apiFetch('/auth/me')).toEqual({ status: 200, data: { ok: 1 }, error: null, meta: undefined });
  });
});
