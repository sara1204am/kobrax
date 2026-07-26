import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsvRows } from './rows.parser';
import { normalizeRecord } from '../field-catalog';

/**
 * Este spec es la prueba de C12: un archivo que NO se parece en nada al Banco Unión
 * —otros encabezados, otro orden, otro idioma de columnas— se importa **sin tocar código**,
 * sólo con configuración. Si esto exigiera un parser nuevo, la app no sería genérica.
 */
const CSV = [
  'NRO;DEUDOR;SALDO;ATRASO', // el separador real se normaliza abajo
  '',
].join('\n');

const CSV_COMA = [
  'NRO,DEUDOR,SALDO,ATRASO,CUOTA',
  '90210,"QUISPE MAMANI ROSA ELENA",12500.50,45,320.75',
  '90211,"VARGAS LEON JULIO CESAR",8300.00,0,210.00',
  '90212,"CHOQUE ROJAS ANA",1500.25,12,95.10',
].join('\n');

const FIELDS = {
  code: { from: 'NRO' },
  clientName: { from: 'DEUDOR' },
  outstandingBalance: { from: 'SALDO' },
  daysPastDue: { from: 'ATRASO' },
  installmentAmount: { from: 'CUOTA' },
};

describe('rows.parser — un formato cualquiera, sin código propio (C12)', () => {
  it('importa un CSV inventado sólo con configuración', () => {
    const { records } = parseCsvRows(CSV_COMA, {}, FIELDS);
    assert.equal(records.length, 3);

    const r = normalizeRecord(records[0]!);
    assert.equal(r.code, '90210');
    assert.equal(r.clientLastName, 'QUISPE MAMANI ROSA ELENA'); // entero → apellido (C13)
    assert.equal(r.outstandingBalance, 12500.5);
    assert.equal(r.daysPastDue, 45);
    assert.equal(r.installmentAmount, 320.75);
  });

  it('separa apellidos y nombres cuando el usuario elige esa regla (§2.3)', () => {
    const { records } = parseCsvRows(CSV_COMA, {}, FIELDS);
    const r = normalizeRecord(records[0]!, 'surnames-first');
    assert.equal(r.clientLastName, 'QUISPE MAMANI');
    assert.equal(r.clientFirstName, 'ROSA ELENA');
  });

  it('lista los encabezados del archivo para emparejar (§6.5)', () => {
    const { labels } = parseCsvRows(CSV_COMA, {}, FIELDS);
    assert.deepEqual(labels, ['NRO', 'DEUDOR', 'SALDO', 'ATRASO', 'CUOTA']);
  });

  it('ofrece como candidatas a "días" sólo las columnas de enteros, no los montos', () => {
    const { columnCandidates } = parseCsvRows(CSV_COMA, {}, FIELDS);
    const headers = columnCandidates.map((c) => c.header);
    assert.ok(headers.includes('ATRASO'));
    assert.ok(!headers.includes('SALDO'), 'SALDO tiene decimales: no es una columna de días');
    assert.ok(!headers.includes('DEUDOR'), 'DEUDOR es texto');

    const atraso = columnCandidates.find((c) => c.header === 'ATRASO')!;
    assert.deepEqual(
      atraso.samples.map((s) => s.value),
      [45, 0, 12],
    );
    assert.equal(atraso.samples[0]!.label, 'QUISPE MAMANI ROSA ELENA');
  });

  it('una columna que no existe en el archivo → null, no 0 (no pisa la mora en la DB)', () => {
    const { records } = parseCsvRows(CSV_COMA, {}, { ...FIELDS, daysPastDue: { from: 'NO_EXISTE' } });
    assert.equal(normalizeRecord(records[0]!).daysPastDue, null);
  });

  it('headerRow permite saltar los renglones de título que traen algunos reportes', () => {
    const conTitulo = `REPORTE DE CARTERA AL 31/12/2025\n${CSV_COMA}`;
    const { records } = parseCsvRows(conTitulo, { headerRow: 2 }, FIELDS);
    assert.equal(records.length, 3);
    assert.equal(normalizeRecord(records[0]!).code, '90210');
  });

  it('firma que no coincide → SIGNATURE_MISMATCH', () => {
    assert.throws(() => parseCsvRows(CSV_COMA, { signature: ['OTRO BANCO'] }, FIELDS), /SIGNATURE_MISMATCH/);
  });

  it('encabezados que no matchean → 0 valores, sin crash (config equivocada, no archivo roto)', () => {
    const { records } = parseCsvRows(CSV, {}, FIELDS);
    assert.equal(records.length, 0);
  });
});
