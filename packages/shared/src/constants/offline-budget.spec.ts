import { describe, expect, it } from 'vitest';
import {
  CACHE_TTL_DAYS,
  IMAGE_CACHE_MAX_BYTES,
  MAP_PACKS_MAX_BYTES,
  MAP_PACK_MAX_REGIONS,
  MAP_PACK_MAX_TILES,
  MAP_PACK_MAX_ZOOM,
  MAP_PACK_MIN_ZOOM,
  MAP_PACK_RADIUS_KM,
  PENDING_PHOTOS_MAX_BYTES,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_EDGE_PX,
  PHOTO_QUALITY_LADDER,
  canQueuePhoto,
  decidePack,
  estimatePackBytes,
  estimatePackTiles,
  nextPhotoQuality,
} from './offline-budget.js';

const MB = 1024 * 1024;
// Sucre (Chuquisaca) y Santa Cruz: las dos zonas de las que hay datos de demo.
const SUCRE = -19.03;
const SANTA_CRUZ = -17.78;

describe('presupuesto offline (D-9) · coherencia', () => {
  it('una foto entra en el tope de la cola y el tope es de varias jornadas', () => {
    expect(PHOTO_MAX_BYTES).toBeLessThan(PENDING_PHOTOS_MAX_BYTES);
    // Peor jornada de la derivación: 35 fotos al techo individual.
    const jornada = 35 * PHOTO_MAX_BYTES;
    expect(jornada / MB).toBeLessThan(30);
    expect(Math.floor(PENDING_PHOTOS_MAX_BYTES / jornada)).toBeGreaterThanOrEqual(5);
  });

  it('el total de lo que el móvil reserva queda muy por debajo del GB que puede faltarle a un teléfono de gama baja', () => {
    const total = PENDING_PHOTOS_MAX_BYTES + IMAGE_CACHE_MAX_BYTES + MAP_PACKS_MAX_BYTES;
    expect(total / MB).toBeLessThan(400);
  });

  it('los packs al máximo caben en su tope de bytes (3 regiones × tiles × peso medio)', () => {
    const peorCaso = MAP_PACK_MAX_REGIONS * estimatePackBytes(MAP_PACK_MAX_TILES);
    expect(peorCaso).toBeLessThanOrEqual(MAP_PACKS_MAX_BYTES);
  });

  it('el lado largo de la foto y la escalera de calidad son los de la regla', () => {
    expect(PHOTO_MAX_EDGE_PX).toBe(1280);
    expect(PHOTO_MAX_BYTES).toBe(800 * 1024);
    expect([...PHOTO_QUALITY_LADDER]).toEqual([0.7, 0.55, 0.4]);
    expect(CACHE_TTL_DAYS).toBe(7);
  });
});

describe('mapas offline · estimación de tiles', () => {
  it('🔴 el pack de referencia (10 km, z10–15) está muy por debajo del tope de tiles', () => {
    const tiles = estimatePackTiles(MAP_PACK_RADIUS_KM, SUCRE, MAP_PACK_MIN_ZOOM, MAP_PACK_MAX_ZOOM);
    expect(tiles).toBeGreaterThan(100);
    expect(tiles).toBeLessThan(MAP_PACK_MAX_TILES);
  });

  it('sumar un nivel de zoom cuadruplica casi los tiles: por eso el 16 no entra', () => {
    const z15 = estimatePackTiles(MAP_PACK_RADIUS_KM, SUCRE, 10, 15);
    const z16 = estimatePackTiles(MAP_PACK_RADIUS_KM, SUCRE, 10, 16);
    expect(z16 / z15).toBeGreaterThan(2.5);
    expect(z16).toBeGreaterThan(MAP_PACK_MAX_TILES * 0.7);
  });

  it('un radio mayor pesa más; la latitud cambia poco el resultado', () => {
    expect(estimatePackTiles(20, SUCRE, 10, 15)).toBeGreaterThan(estimatePackTiles(10, SUCRE, 10, 15));
    const a = estimatePackTiles(10, SUCRE, 10, 15);
    const b = estimatePackTiles(10, SANTA_CRUZ, 10, 15);
    expect(Math.abs(a - b) / a).toBeLessThan(0.15);
  });

  it('decidePack: acepta el de referencia y rechaza uno enorme o sin lugar', () => {
    const ok = decidePack({ radiusKm: 10, latitude: SUCRE, minZoom: 10, maxZoom: 15, usedBytes: 0 });
    expect(ok.ok).toBe(true);
    const enorme = decidePack({ radiusKm: 60, latitude: SUCRE, minZoom: 8, maxZoom: 16, usedBytes: 0 });
    expect(enorme).toMatchObject({ ok: false, reason: 'too-many-tiles' });
    const sinLugar = decidePack({ radiusKm: 10, latitude: SUCRE, minZoom: 10, maxZoom: 15, usedBytes: MAP_PACKS_MAX_BYTES - 1024 });
    expect(sinLugar).toMatchObject({ ok: false, reason: 'over-storage' });
  });
});

describe('fotos · compresión y cupo', () => {
  it('la escalera baja de a un escalón y termina en null', () => {
    expect(nextPhotoQuality(0.7)).toBe(0.55);
    expect(nextPhotoQuality(0.55)).toBe(0.4);
    expect(nextPhotoQuality(0.4)).toBeNull();
  });

  it('una calidad que no está en la escalera arranca desde el primer escalón', () => {
    expect(nextPhotoQuality(0.9)).toBe(0.7);
  });

  it('🔴 al tope se bloquea la foto NUEVA con un motivo claro; antes del tope entra', () => {
    expect(canQueuePhoto({ pendingBytes: 0, newBytes: PHOTO_MAX_BYTES })).toEqual({ allowed: true, warn: false });
    expect(canQueuePhoto({ pendingBytes: PENDING_PHOTOS_MAX_BYTES - PHOTO_MAX_BYTES + 1, newBytes: PHOTO_MAX_BYTES })).toEqual({
      allowed: false,
      reason: 'pending-full',
    });
  });

  it('al 80 % del tope avisa que hay que sincronizar, sin bloquear', () => {
    const cerca = PENDING_PHOTOS_MAX_BYTES * 0.8;
    expect(canQueuePhoto({ pendingBytes: cerca, newBytes: PHOTO_MAX_BYTES })).toEqual({ allowed: true, warn: true });
  });
});
