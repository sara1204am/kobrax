import { lugarLabel } from './route-labels';

describe('lugarLabel', () => {
  it('sin dueño: el tipo', () => expect(lugarLabel({ locationType: 'WORK' })).toBe('Trabajo'));
  it('con dueño y relación', () =>
    expect(lugarLabel({ locationType: 'HOME', ownerName: 'Luis Vargas', ownerRelation: 'GUARANTOR' })).toBe('Casa de Luis Vargas (garante)'));
  it('con dueño sin relación', () => expect(lugarLabel({ locationType: 'HOME', ownerName: 'Ana' })).toBe('Casa de Ana'));
  it('tipo desconocido o ausente', () => {
    expect(lugarLabel({ locationType: 'X' })).toBe('Ubicación');
    expect(lugarLabel({})).toBe('Ubicación');
  });
});
