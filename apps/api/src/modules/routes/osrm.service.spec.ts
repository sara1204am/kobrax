import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { OsrmService } from './osrm.service';

const P = [
  { latitude: -17.78, longitude: -63.18 },
  { latitude: -17.76, longitude: -63.19 },
  { latitude: -17.75, longitude: -63.2 },
];

const realFetch = globalThis.fetch;
let urls: string[] = [];

/** Reemplaza `fetch` por una respuesta fija y guarda la URL pedida. */
function stub(response: unknown, ok = true) {
  urls = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return { ok, status: ok ? 200 : 502, json: async () => response };
  }) as never;
}

beforeEach(() => {
  urls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const PATH = {
  distance: 12400,
  duration: 2700,
  geometry: { coordinates: [[-63.18, -17.78], [-63.2, -17.75]] },
  legs: [{ distance: 6000, duration: 1200 }, { distance: 6400, duration: 1500 }],
};

describe('OsrmService.route', () => {
  it('traduce la respuesta y da vuelta las coordenadas de GeoJSON', async () => {
    stub({ code: 'Ok', routes: [PATH] });
    const r = await new OsrmService().route(P);
    assert.equal(r!.distanceM, 12400);
    assert.equal(r!.legs.length, 2);
    // GeoJSON es [lng,lat]; adentro todo viaja como {latitude,longitude}.
    assert.deepEqual(r!.geometry[0], { latitude: -17.78, longitude: -63.18 });
    assert.ok(urls[0]!.includes('/route/v1/car/-63.18,-17.78;'));
  });

  it('con menos de dos puntos no llama a OSRM', async () => {
    stub({ code: 'Ok', routes: [PATH] });
    assert.equal(await new OsrmService().route([P[0]!]), null);
    assert.equal(urls.length, 0);
  });

  it('OSRM caído devuelve null, no revienta (el preview se degrada)', async () => {
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as never;
    assert.equal(await new OsrmService().route(P), null);
  });

  it('sin camino entre los puntos devuelve null', async () => {
    stub({ code: 'NoRoute' });
    assert.equal(await new OsrmService().route(P), null);
  });

  it('un 502 del servicio devuelve null', async () => {
    stub({}, false);
    assert.equal(await new OsrmService().route(P), null);
  });
});

describe('OsrmService.trip', () => {
  it('invierte waypoint_index a "qué punto va en cada posición"', async () => {
    // El punto 1 (el segundo que se mandó) queda tercero, y el punto 2 queda segundo.
    stub({ code: 'Ok', trips: [PATH], waypoints: [{ waypoint_index: 0 }, { waypoint_index: 2 }, { waypoint_index: 1 }] });
    const t = await new OsrmService().trip(P);
    assert.deepEqual(t!.order, [0, 2, 1]);
    assert.ok(urls[0]!.includes('source=first'));
    assert.ok(urls[0]!.includes('roundtrip=false'));
  });

  it('una respuesta con waypoints incompletos devuelve null (no se inventa un orden)', async () => {
    stub({ code: 'Ok', trips: [PATH], waypoints: [{ waypoint_index: 0 }, {}, { waypoint_index: 2 }] });
    assert.equal(await new OsrmService().trip(P), null);
  });
});
