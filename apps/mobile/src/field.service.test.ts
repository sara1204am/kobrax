import { createVisit, resolveVisitCoords } from './field.service';
import { currentLocation } from './location';

jest.mock('./location', () => ({ currentLocation: jest.fn() }));
const mockVisitBodies: unknown[] = [];
jest.mock('./api-client', () => ({
  apiMutate: jest.fn(async (_p: string, _m: string, body: unknown) => {
    mockVisitBodies.push(body);
    return { status: 'ok', data: {} };
  }),
}));
const mocked = currentLocation as jest.MockedFunction<typeof currentLocation>;

const PARADA = { latitude: -17.78, longitude: -63.18 };

describe('resolveVisitCoords (S5 — el registro nunca se bloquea por GPS)', () => {
  it('con GPS usa la lectura real y NO la marca como estimada', async () => {
    mocked.mockResolvedValue({ status: 'ok', coords: { latitude: -16.5, longitude: -68.15, accuracy: 12 } });
    expect(await resolveVisitCoords(PARADA)).toEqual({
      latitude: -16.5,
      longitude: -68.15,
      accuracy: 12,
      gpsFallback: false,
    });
  });

  it('sin permiso cae en la ubicación de la parada, marcada como estimada', async () => {
    mocked.mockResolvedValue({ status: 'denied' });
    expect(await resolveVisitCoords(PARADA)).toEqual({ ...PARADA, gpsFallback: true });
  });

  it('sin señal hace lo mismo: el cobrador igual cierra la visita', async () => {
    mocked.mockResolvedValue({ status: 'unavailable' });
    expect(await resolveVisitCoords(PARADA)).toEqual({ ...PARADA, gpsFallback: true });
  });

  it('sin GPS y sin coordenada de la parada devuelve null (el server lo rechazaría igual)', async () => {
    mocked.mockResolvedValue({ status: 'denied' });
    expect(await resolveVisitCoords(undefined)).toBeNull();
    expect(await resolveVisitCoords({ latitude: undefined, longitude: undefined })).toBeNull();
  });

  it('una parada a medio ubicar (sólo latitud) no sirve de respaldo', async () => {
    mocked.mockResolvedValue({ status: 'denied' });
    expect(await resolveVisitCoords({ latitude: -17.78 })).toBeNull();
  });
});

describe('createVisit · por crédito (F4/08)', () => {
  it('manda creditId + routeStopId + id del teléfono, sin caseId', async () => {
    await createVisit({ id: 'v1', creditId: 'cr1', routeStopId: 's1', lat: 1, lng: 2, outcome: 'PAID' as never });
    expect(mockVisitBodies[0]).toMatchObject({ id: 'v1', creditId: 'cr1', routeStopId: 's1' });
    expect(mockVisitBodies[0]).not.toHaveProperty('caseId');
  });
});
