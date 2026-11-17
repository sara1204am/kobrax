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

describe('toCsv — inyección de fórmulas (S-8)', () => {
  it('neutraliza texto que empieza con = + - @ en cualquier export, y deja números y fechas intactos', () => {
    const out = toCsv([{ a: '=HYPERLINK("x")', b: '+1', c: '@cmd', d: -5, e: 'normal' }], ['a', 'b', 'c', 'd', 'e']);
    const row = out.split('\n')[1]!;
    assert.ok(row.startsWith(`"'=HYPERLINK(""x"")",'+1,'@cmd,-5,normal`), row);
  });
  it('es idempotente con lo que ya pasó por csvSafeText', () => {
    assert.equal(toCsv([{ a: "'=x" }], ['a']).split('\n')[1], "'=x");
  });
});
