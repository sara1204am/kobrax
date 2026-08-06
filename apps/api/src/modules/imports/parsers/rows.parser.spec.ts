import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { cellText, parseCsvRows, parseRowsFile } from './rows.parser';
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
});

/** Arma un `.xlsx` de verdad en memoria: el mismo zip que subiría el usuario. */
async function xlsxDe(filas: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Cartera');
  for (const f of filas) ws.addRow(f);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('rows.parser — la misma planilla, en Excel', () => {
  const FILAS = [
    ['NRO', 'DEUDOR', 'SALDO', 'ATRASO', 'CUOTA'],
    [90210, 'QUISPE MAMANI ROSA ELENA', 12500.5, 45, 320.75],
    [90211, 'VARGAS LEON JULIO CESAR', 8300, 0, 210],
  ];

  it('lee un xlsx con el mismo resultado que el CSV equivalente', async () => {
    const { records, labels } = await parseRowsFile(await xlsxDe(FILAS), {}, FIELDS);
    assert.deepEqual(labels, ['NRO', 'DEUDOR', 'SALDO', 'ATRASO', 'CUOTA']);
    assert.equal(records.length, 2);

    const r = normalizeRecord(records[0]!);
    assert.equal(r.code, '90210'); // number en Excel → string, como espera el resto del import
    assert.equal(r.clientLastName, 'QUISPE MAMANI ROSA ELENA');
    assert.equal(r.outstandingBalance, 12500.5);
    assert.equal(r.daysPastDue, 45);
  });

  it('el motor lo eligen los BYTES, no la config: el mismo perfil `rows` abre CSV y Excel', async () => {
    const porCsv = await parseRowsFile(Buffer.from(CSV_COMA, 'utf8'), {}, FIELDS);
    const porXlsx = await parseRowsFile(await xlsxDe(FILAS), {}, FIELDS);
    assert.equal(normalizeRecord(porCsv.records[0]!).code, '90210');
    assert.equal(normalizeRecord(porXlsx.records[0]!).code, '90210');
  });

  it('headerRow saltea el título también en Excel', async () => {
    const conTitulo = await xlsxDe([['REPORTE DE CARTERA AL 31/12/2025'], ...FILAS]);
    const { records } = await parseRowsFile(conTitulo, { headerRow: 2 }, FIELDS);
    assert.equal(records.length, 2);
    assert.equal(normalizeRecord(records[0]!).code, '90210');
  });

  it('firma que no coincide → SIGNATURE_MISMATCH, igual que el CSV', async () => {
    const file = await xlsxDe(FILAS);
    await assert.rejects(() => parseRowsFile(file, { signature: ['OTRO BANCO'] }, FIELDS), /SIGNATURE_MISMATCH/);
  });
});

describe('cellText — Excel no guarda texto', () => {
  it('una fecha sale como YYYY-MM-DD, que es lo que normalizeRecord sabe leer', () => {
    assert.equal(cellText(new Date(Date.UTC(2026, 7, 6))), '2026-08-06');
  });

  it('de una fórmula vale el resultado, no la fórmula', () => {
    assert.equal(cellText({ formula: 'A1*2', result: 250.5 }), '250.5');
  });

  it('el texto enriquecido se aplana y el hipervínculo deja su texto', () => {
    assert.equal(cellText({ richText: [{ text: 'QUISPE ' }, { text: 'ROSA' }] }), 'QUISPE ROSA');
    assert.equal(cellText({ text: '90210', hyperlink: 'http://x' }), '90210');
  });

  it('una celda rota o vacía es cadena vacía, no rompe la fila', () => {
    assert.equal(cellText({ error: '#N/A' }), '');
    assert.equal(cellText(null), '');
    assert.equal(cellText(undefined), '');
  });

  it('encabezados que no matchean → 0 valores, sin crash (config equivocada, no archivo roto)', () => {
    const { records } = parseCsvRows(CSV, {}, FIELDS);
    assert.equal(records.length, 0);
  });
});
