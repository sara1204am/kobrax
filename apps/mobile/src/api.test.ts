// expo-constants lee app.json en el dispositivo; en jest no hay manifiesto, así que se fija una versión conocida.
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '9.9.9' } } }));

import { apiFetch, appVersion, postMultipart, uploadFailure, UploadTimeout } from './api';

/**
 * Un archivo que no se puede abrir y una red caída son problemas distintos con arreglos
 * distintos. El `catch` los metía en el mismo balde: subir un PDF de Drive que había quedado sin
 * copia local decía "Sin conexión", y la usuaria se fue a revisar el wifi.
 */
describe('uploadFailure — no todo lo que falla es falta de red', () => {
  it('sólo el error de red de RN es "sin conexión"', () => {
    expect(uploadFailure(new TypeError('Network request failed'))).toEqual({ status: 'offline' });
    expect(uploadFailure(new UploadTimeout())).toEqual({ status: 'offline' });
  });

  it('un archivo ilegible se reporta como tal, con el motivo crudo', () => {
    const res = uploadFailure(new Error('Could not retrieve file for uri content://drive/1234'));
    expect(res.status).toBe('error');
    expect(res).toHaveProperty('message', expect.stringContaining('content://drive/1234'));
  });
});

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

    // `reason: 'timeout'`: lo cortamos nosotros, el resultado es DESCONOCIDO (el pedido pudo haber llegado).
    expect(await pending).toEqual({
      status: 0,
      reason: 'timeout',
      data: null,
      error: { code: 'NETWORK', message: 'Sin conexión' },
    });
  });

  it('sin red (el fetch falla solo) es status 0 con reason offline: el server NO vio el pedido', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    expect(await apiFetch('/auth/me')).toMatchObject({ status: 0, reason: 'offline' });
  });

  it('una respuesta normal no espera al reloj', async () => {
    global.fetch = jest.fn(async () => ({
      status: 200,
      json: async () => ({ data: { ok: 1 }, error: null }),
    })) as unknown as typeof fetch;

    expect(await apiFetch('/auth/me')).toEqual({ status: 200, data: { ok: 1 }, error: null, meta: undefined });
  });
});

/**
 * El server necesita saber qué contrato habla la app (ids opcionales, toTime…). La versión sale de app.json.
 */
describe('x-app-version', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('la versión viene de la config de la app', () => {
    expect(appVersion()).toBe('9.9.9');
  });

  it('viaja en toda llamada JSON', async () => {
    const fetchMock = jest.fn(async () => ({ status: 200, json: async () => ({ data: 1, error: null }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await apiFetch('/x');
    const init = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers['x-app-version']).toBe('9.9.9');
    expect(init.headers['x-client-type']).toBe('mobile');
  });

  it('y en las subidas multipart', async () => {
    const fetchMock = jest.fn(async () => ({ status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    await postMultipart('/uploads', new FormData(), 'tok');
    const init = (fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }])[1];
    expect(init.headers['x-app-version']).toBe('9.9.9');
    expect(init.headers.authorization).toBe('Bearer tok');
  });
});
