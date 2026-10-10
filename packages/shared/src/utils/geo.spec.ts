import { describe, expect, it } from 'vitest';
import { formatDistanceKm, haversineKm } from './geo.js';

describe('haversineKm', () => {
  it('mismo punto = 0', () => {
    expect(haversineKm({ latitude: -19.04, longitude: -65.26 }, { latitude: -19.04, longitude: -65.26 })).toBe(0);
  });

  it('un grado de latitud ≈ 111 km', () => {
    const d = haversineKm({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });
    expect(d).toBeGreaterThan(110.5);
    expect(d).toBeLessThan(111.9);
  });

  it('es simétrica', () => {
    const a = { latitude: -19.04, longitude: -65.26 };
    const b = { latitude: -16.5, longitude: -68.15 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });
});

describe('formatDistanceKm', () => {
  it('menos de 1 km en metros redondeados a 100', () => expect(formatDistanceKm(0.45)).toBe('500 m'));
  it('desde 1 km con coma decimal', () => expect(formatDistanceKm(2.34)).toBe('2,3 km'));
  it('casi cero es «aquí»', () => expect(formatDistanceKm(0.02)).toBe('aquí'));
  it('inválida no inventa', () => expect(formatDistanceKm(NaN)).toBe(''));
});
