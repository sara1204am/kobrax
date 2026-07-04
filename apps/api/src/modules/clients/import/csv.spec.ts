import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parsea cabecera + filas', () => {
    const out = parseCsv('firstName,lastName,nationalId\nJuan,Pérez,CI-1\nEva,Test,CI-2');
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { firstName: 'Juan', lastName: 'Pérez', nationalId: 'CI-1' });
    assert.equal(out[1]!.nationalId, 'CI-2');
  });

  it('respeta comas y saltos de línea dentro de comillas, y comillas escapadas', () => {
    const out = parseCsv('name,note\n"Pérez, Juan","dijo ""hola""\nsegunda línea"');
    assert.equal(out.length, 1);
    assert.equal(out[0]!.name, 'Pérez, Juan');
    assert.equal(out[0]!.note, 'dijo "hola"\nsegunda línea');
  });

  it('ignora líneas vacías', () => {
    const out = parseCsv('a,b\n1,2\n\n3,4\n');
    assert.equal(out.length, 2);
  });
});
