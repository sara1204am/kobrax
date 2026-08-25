import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from './csv';

describe('toCsv', () => {
  it('arranca con BOM y separa cabecera de filas', () => {
    const csv = toCsv([{ a: '1', b: '2' }], ['a', 'b']);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(csv.slice(1), 'a,b\n1,2\n');
  });

  it('comilla celdas con coma, comilla o salto de línea, y escapa comillas internas', () => {
    const csv = toCsv([{ nombre: 'Pérez, Ana "la" grande', obs: 'línea1\nlínea2' }], ['nombre', 'obs']);
    assert.match(csv, /"Pérez, Ana ""la"" grande","línea1\nlínea2"/);
  });

  it('celdas nulas o indefinidas salen vacías', () => {
    const csv = toCsv([{ a: null, b: undefined }], ['a', 'b']);
    assert.equal(csv.slice(1), 'a,b\n,\n');
  });
});
