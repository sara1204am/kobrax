import { boundsSideKm, planPack, type RegionBounds } from './pack-budget';

/** Un bbox cuadrado de `radiusKm` alrededor de Sucre, como lo arma `boundsAround`. */
function around(radiusKm: number, lat = -19.03, lng = -65.26): RegionBounds {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return { neLat: lat + dLat, neLng: lng + dLng, swLat: lat - dLat, swLng: lng - dLng };
}

describe('pack-budget · mapas offline (D-9)', () => {
  it('mide el lado de un bbox en km', () => {
    expect(boundsSideKm(around(10))).toBeCloseTo(20, 0);
  });

  it('el pack de referencia (10 km, z10–15) entra: unos cientos de tiles y pocos MB', () => {
    const plan = planPack({ bounds: around(10), existing: { count: 0, bytes: 0 } });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.tiles).toBeLessThan(1500);
      expect(plan.bytes / 1048576).toBeLessThan(30);
      expect([plan.minZoom, plan.maxZoom]).toEqual([10, 15]);
    }
  });

  it('🔴 el zoom 16 que traía el servicio viejo ya no se pide: el máximo es 15', () => {
    const plan = planPack({ bounds: around(10), maxZoom: 16, existing: { count: 0, bytes: 0 } });
    expect(plan.ok && plan.maxZoom).toBe(15);
  });

  it('el default viejo (15 km, hasta z16) hubiera pesado casi 100 MB: ahora se rechaza por tamaño', () => {
    const plan = planPack({ bounds: around(30), minZoom: 10, maxZoom: 15, existing: { count: 0, bytes: 0 } });
    expect(plan).toMatchObject({ ok: false, reason: 'too-many-tiles' });
    if (!plan.ok) expect(plan.message).toMatch(/10 km/);
  });

  it('al llegar al máximo de zonas pide eliminar una (no borra nada por su cuenta)', () => {
    const plan = planPack({ bounds: around(10), existing: { count: 3, bytes: 0 } });
    expect(plan).toMatchObject({ ok: false, reason: 'too-many-regions' });
  });

  it('sin lugar en el presupuesto total lo dice con cuánto pesaría', () => {
    const plan = planPack({ bounds: around(10), existing: { count: 1, bytes: 150 * 1048576 - 1024 } });
    expect(plan).toMatchObject({ ok: false, reason: 'over-storage' });
    if (!plan.ok) expect(plan.message).toMatch(/MB/);
  });
});
