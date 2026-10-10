import { describe, expect, it } from 'vitest';
import { withinRadius, type AvailableCredit } from '@/lib/plan';
import { candidatePins, describeLocation, distanceLabel, nearbySuggestions, parsePinId, pinId } from './candidate-pins';

// Plaza Murillo, La Paz. Un grado de latitud son ~111 km: 0.0045° ≈ 500 m.
const PLAZA = { latitude: -16.4955, longitude: -68.1336 };
const NORTE_500M = { latitude: -16.4955 + 0.0045, longitude: -68.1336 };
const NORTE_3KM = { latitude: -16.4955 + 0.027, longitude: -68.1336 };

const credit = (id: string, locations: AvailableCredit['locations']): AvailableCredit => ({
  id,
  clientId: `cl-${id}`,
  clientName: `Cliente ${id}`,
  amount: 1000,
  currency: 'BOB',
  daysPastDue: 10,
  locations,
});

const label = (type: string) => ({ HOME: 'Domicilio', WORK: 'Trabajo', GUARANTOR: 'Garante' })[type] ?? type;

describe('pinId / parsePinId', () => {
  it('un pin de candidato lleva crédito y ubicación; uno elegido, sólo el crédito', () => {
    expect(pinId('c1', 'l1')).toBe('c1@l1');
    expect(pinId('c1')).toBe('c1');
    expect(parsePinId('c1@l1')).toEqual({ creditId: 'c1', locationId: 'l1' });
    expect(parsePinId('c1')).toEqual({ creditId: 'c1' });
    expect(parsePinId('c1@')).toEqual({ creditId: 'c1' });
  });
});

describe('describeLocation', () => {
  it('dice el lugar, de quién es y la dirección', () => {
    expect(describeLocation({ locationType: 'GUARANTOR', ownerName: 'Juan Pérez', address: 'Calle 5', latitude: 0, longitude: 0 }, label)).toBe(
      'Garante · Juan Pérez · Calle 5',
    );
    expect(describeLocation({ locationType: 'HOME', address: 'Calle 12', latitude: 0, longitude: 0 }, label)).toBe('Domicilio · Calle 12');
    expect(describeLocation({ latitude: 0, longitude: 0 }, label)).toBe('');
  });
});

describe('candidatePins', () => {
  const rows = [
    credit('a', [
      { id: 'a1', locationType: 'HOME', address: 'Calle 1', ...PLAZA },
      { id: 'a2', locationType: 'WORK', address: 'Av. 2', ...NORTE_500M },
    ]),
    credit('b', [{ id: 'b1', locationType: 'HOME', ...NORTE_3KM }]),
    credit('c', undefined),
  ];

  it('🔴 un pin por cada ubicación, no sólo la principal', () => {
    const pins = candidatePins(rows, { skip: new Set(), typeLabel: label, detail: () => 'Bs 1.000' });
    expect(pins.map((p) => p.id)).toEqual(['a@a1', 'a@a2', 'b@b1']);
    expect(pins[1]!.detail).toBe('Bs 1.000 · Trabajo · Av. 2');
    expect(pins.every((p) => p.picked === false)).toBe(true);
  });

  it('no ofrece lo que ya va en la ruta', () => {
    const pins = candidatePins(rows, { skip: new Set(['a']), typeLabel: label, detail: () => '' });
    expect(pins.map((p) => p.id)).toEqual(['b@b1']);
  });
});

describe('nearbySuggestions (visitas preventivas)', () => {
  const stops = [PLAZA];

  it('🔴 sugiere lo que queda a menos de 1 km de alguna parada, lo más cerca primero', () => {
    const rows = [
      credit('lejos', [{ id: 'l1', ...NORTE_3KM }]),
      credit('cerca', [{ id: 'c1', ...NORTE_500M }]),
      credit('encima', [{ id: 'e1', latitude: PLAZA.latitude + 0.0009, longitude: PLAZA.longitude }]),
    ];
    const out = nearbySuggestions(rows, stops, 1);
    expect(out.map((s) => s.credit.id)).toEqual(['encima', 'cerca']);
    expect(out[0]!.km).toBeLessThan(out[1]!.km);
  });

  it('con varias ubicaciones, la que queda cerca es la que cuenta (aunque la principal esté lejos)', () => {
    const rows = [
      credit('x', [
        { id: 'x1', locationType: 'HOME', ...NORTE_3KM },
        { id: 'x2', locationType: 'WORK', ...NORTE_500M },
      ]),
    ];
    const [s] = nearbySuggestions(rows, stops, 1);
    expect(s!.location.id).toBe('x2');
    // Su lugar entre las ubicaciones: con el que `candidatePins` arma el id de los pines sin id de ubicación.
    expect(s!.index).toBe(1);
  });

  it('mide contra cualquier parada, no sólo la primera', () => {
    const rows = [credit('y', [{ id: 'y1', ...NORTE_3KM }])];
    expect(nearbySuggestions(rows, [PLAZA], 1)).toEqual([]);
    expect(nearbySuggestions(rows, [PLAZA, { latitude: NORTE_3KM.latitude - 0.002, longitude: NORTE_3KM.longitude }], 1)).toHaveLength(1);
  });

  it('sin paradas con punto, o sin ubicación, no sugiere nada', () => {
    expect(nearbySuggestions([credit('z', [{ id: 'z1', ...NORTE_500M }])], [], 1)).toEqual([]);
    expect(nearbySuggestions([credit('w', undefined)], stops, 1)).toEqual([]);
  });
});

describe('distanceLabel', () => {
  it('bajo el kilómetro se dice en metros, redondeado a la decena', () => {
    expect(distanceLabel(0.347)).toBe('350 m');
    expect(distanceLabel(0.04)).toBe('40 m');
  });
  it('desde un kilómetro, en km con un decimal', () => {
    expect(distanceLabel(1.26, 'en')).toBe('1.3 km');
  });
});

describe('withinRadius con varias ubicaciones', () => {
  it('🔴 entra si CUALQUIERA de sus ubicaciones cae adentro', () => {
    const rows = [
      credit('lejosPeroTrabajaAca', [
        { id: '1', locationType: 'HOME', ...NORTE_3KM },
        { id: '2', locationType: 'WORK', ...PLAZA },
      ]),
      credit('soloLejos', [{ id: '3', ...NORTE_3KM }]),
    ];
    expect(withinRadius(rows, PLAZA, 1).map((r) => r.id)).toEqual(['lejosPeroTrabajaAca']);
  });
});
