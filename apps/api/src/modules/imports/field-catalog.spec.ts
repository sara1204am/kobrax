import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { num } from './field-catalog';

/**
 * Leer plata. Es la función más consecuente del import: un saldo mal leído entra sin que nadie
 * lo note, a diferencia de uno que falta. No se puede fijar una convención de separadores porque
 * los reportes de un mismo país mezclan las tres.
 */
describe('num — separadores de miles y decimales', () => {
  it('las tres convenciones que aparecen en reportes reales', () => {
    assert.equal(num('859,743.98'), 859743.98); // coma miles, punto decimal
    assert.equal(num('1.682,11'), 1682.11); // punto miles, coma decimal
    assert.equal(num('1.996.85'), 1996.85); // punto para las dos cosas
    assert.equal(num('13.972.33'), 13972.33);
  });

  it('tres cifras detrás del último separador son miles, no decimales', () => {
    // La ambigüedad real de "1.234". Se resuelve por la cantidad de cifras, que es la convención
    // universal: nadie escribe tres decimales en un saldo.
    assert.equal(num('1.234'), 1234);
    assert.equal(num('1,234'), 1234);
    assert.equal(num('1.234.567'), 1234567);
  });

  it('negativos entre paréntesis, porcentajes y enteros pelados', () => {
    assert.equal(num('( 4,767.67)'), -4767.67);
    assert.equal(num('7.00 %'), 7);
    assert.equal(num('25'), 25);
  });

  it('lo que no es un número vuelve null, no cero', () => {
    // `null` ≠ 0 es la regla dura del catálogo: un 0 inventado pondría la cartera en cero.
    assert.equal(num('48 M'), null);
    assert.equal(num(''), null);
    assert.equal(num(null), null);
  });
});
