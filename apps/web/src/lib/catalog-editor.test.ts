import { describe, it, expect } from 'vitest';
import { codeFromLabel, EDITABLE_CATALOGS, isEditableCatalog, reorderPatches } from './catalog-editor';

describe('codeFromLabel', () => {
  it('saca un código estable del nombre, sin tildes ni símbolos', () => {
    expect(codeFromLabel('Pago móvil', [])).toBe('PAGO_MOVIL');
    expect(codeFromLabel('  Banco  Nacional (BNB) ', [])).toBe('BANCO_NACIONAL_BNB');
    expect(codeFromLabel('Año nuevo', [])).toBe('ANO_NUEVO');
  });

  it('si el código ya existe, le suma un número en vez de chocar', () => {
    expect(codeFromLabel('Efectivo', ['EFECTIVO'])).toBe('EFECTIVO_2');
    expect(codeFromLabel('Efectivo', ['EFECTIVO', 'EFECTIVO_2'])).toBe('EFECTIVO_3');
  });

  it('un nombre sin letras ni números cae a ITEM', () => {
    expect(codeFromLabel('¿¿??', [])).toBe('ITEM');
  });

  it('no pasa de 40 caracteres ni siquiera con el sufijo', () => {
    const code = codeFromLabel('x'.repeat(100), ['X'.repeat(36)]);
    expect(code.length).toBeLessThanOrEqual(40);
    expect(code).toBe(`${'X'.repeat(36)}_2`);
  });
});

describe('reorderPatches', () => {
  const items = [
    { id: 'a', sortOrder: 1 },
    { id: 'b', sortOrder: 2 },
    { id: 'c', sortOrder: 3 },
  ];

  it('subir intercambia con el vecino y devuelve sólo los dos que cambian', () => {
    expect(reorderPatches(items, 1, -1)).toEqual([
      { id: 'b', sortOrder: 1 },
      { id: 'a', sortOrder: 2 },
    ]);
  });

  it('bajar el último o subir el primero no hace nada', () => {
    expect(reorderPatches(items, 0, -1)).toEqual([]);
    expect(reorderPatches(items, 2, 1)).toEqual([]);
  });

  it('con todos en 0 (como vienen de un alta sin orden) normaliza 1, 2, 3…', () => {
    const planos = [
      { id: 'a', sortOrder: 0 },
      { id: 'b', sortOrder: 0 },
      { id: 'c', sortOrder: 0 },
    ];
    expect(reorderPatches(planos, 2, -1)).toEqual([
      { id: 'a', sortOrder: 1 },
      { id: 'c', sortOrder: 2 },
      { id: 'b', sortOrder: 3 },
    ]);
  });
});

describe('catálogos editables', () => {
  it('no incluye plantillas ni los que la lógica del producto usa por código', () => {
    for (const fuera of ['WHATSAPP_TEMPLATE', 'INCOME_SOURCE', 'PRIORITY', 'EXPECTED_RESULT', 'CURRENCY', 'CAMPAIGN']) {
      expect(isEditableCatalog(fuera)).toBe(false);
    }
    expect(EDITABLE_CATALOGS).toContain('NO_PAYMENT_REASON');
  });

  it('un valor inventado o ausente no es editable', () => {
    expect(isEditableCatalog('LO_QUE_SEA')).toBe(false);
    expect(isEditableCatalog(undefined)).toBe(false);
  });
});
