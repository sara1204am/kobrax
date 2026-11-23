import { describe, expect, it } from 'vitest';
import { collateralMissing, collateralPayload, emptyCollateral, hasCollateralData } from './client-form.js';

describe('garantía de tipo «Otro»', () => {
  it('con «Otro» viaja lo que se especificó', () => {
    const g = { ...emptyCollateral('g1'), type: 'OTHER', typeOther: '  Terreno ', description: 'Lote en Warnes' };
    expect(collateralPayload(g).typeOther).toBe('Terreno');
  });
  it('con otro tipo viaja vacío, para que la API borre lo que hubiera', () => {
    const g = { ...emptyCollateral('g1'), type: 'VEHICLE', typeOther: 'Terreno', description: 'Moto' };
    expect(collateralPayload(g).typeOther).toBe('');
  });

  it('obligatorios: tipo, «qué» si es Otro, y valor mayor a cero; la descripción no', () => {
    const base = emptyCollateral('g1');
    expect(collateralMissing(base)).toEqual(['type', 'value']);
    expect(collateralMissing({ ...base, type: 'OTHER', estimatedValue: '500' })).toEqual(['typeOther']);
    expect(collateralMissing({ ...base, type: 'OTHER', typeOther: 'Terreno', estimatedValue: '500' })).toEqual([]);
    expect(collateralMissing({ ...base, type: 'VEHICLE', estimatedValue: '0' })).toEqual(['value']);
    expect(collateralMissing({ ...base, type: 'VEHICLE', estimatedValue: '1200' })).toEqual([]); // sin descripción, vale
  });

  it('una fila a medio llenar se conserva (para marcarla); una vacía se descarta', () => {
    expect(hasCollateralData(emptyCollateral('g1'))).toBe(false);
    expect(hasCollateralData({ ...emptyCollateral('g1'), type: 'VEHICLE' })).toBe(true);
    expect(hasCollateralData({ ...emptyCollateral('g1'), estimatedValue: '10' })).toBe(true);
  });
});
