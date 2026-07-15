import { resolveStopCoords, type RouteStopItem } from './routes.service';
import { RouteStopStatus } from '@kobrax/shared';

const stop = (id: string, clientId: string): RouteStopItem => ({
  id,
  clientId,
  sequenceOrder: 1,
  status: RouteStopStatus.PENDING,
});

describe('resolveStopCoords', () => {
  it('adjunta coords cuando el cliente tiene ubicación', () => {
    const out = resolveStopCoords([stop('s1', 'c1')], { c1: { latitude: -17.7, longitude: -63.1 } });
    expect(out[0]).toMatchObject({ id: 's1', latitude: -17.7, longitude: -63.1 });
  });

  it('deja lat/lng undefined si el cliente no tiene ubicación conocida', () => {
    const out = resolveStopCoords([stop('s1', 'cX')], {});
    expect(out[0].latitude).toBeUndefined();
    expect(out[0].longitude).toBeUndefined();
  });

  it('preserva el orden y no muta las paradas de entrada', () => {
    const stops = [stop('s1', 'c1'), stop('s2', 'c2')];
    const out = resolveStopCoords(stops, { c1: { latitude: 1, longitude: 2 } });
    expect(out.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(stops[0]).not.toHaveProperty('latitude');
  });
});
