import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parsePdfBlocks, type FieldMap, type PdfBlocksProfile } from './pdf-blocks.parser';
import { normalizeRecord } from '../field-catalog';

// Muestra real: extracto Banco Unión PRR0785A, VIGENTE, mora 0 (docs/flows/).
// Es el ÚNICO archivo real que tenemos, así que se queda como fixture.
const here = dirname(fileURLToPath(import.meta.url));
const PDF = resolve(here, '../../../../../../docs/flows/mora union.PDF');

// pdfjs se queda con el buffer (lo deja detached) al parsear → bytes frescos por llamada.
const bytes = (): Uint8Array => new Uint8Array(readFileSync(PDF));

// La configuración con la que se lee ESTE archivo. Vive acá, en el test, y NO en el producto:
// el motor no sabe de qué banco es nada (C12), y el usuario arma esto mismo desde Ajustes
// subiendo un archivo de muestra. Que un formato conocido no venga prellenado es deliberado —
// prellenarlo desde la app significaba mantener un catálogo de bancos en el código.
const profile: PdfBlocksProfile = {
  signature: ['REPORTE DE EXTRACTO DE PRESTAMOS', 'PRR0785A'],
  recordStart: 'Cliente',
  tableAnchor: 'Capital',
};
const fields: FieldMap = {
  code: { from: 'No.Credito' },
  clientName: { from: 'Cliente' },
  coHolder: { from: 'Cliente', in: 'below' },
  status: { from: 'Estado' },
  principalAmount: { from: 'Monto' },
  outstandingBalance: { from: 'Saldo Credito' },
  interestRate: { from: 'Tasa Interes' },
  currency: { from: 'Moneda' },
  disbursedAt: { from: 'Fecha Desembolso' },
  daysPastDue: { from: 'Dias Mora', in: 'table' },
  pastDueAmount: { from: 'Moratorios', in: 'table' },
};

describe('pdf-blocks.parser — motor genérico sobre un extracto real', () => {
  it('lee el registro pasando el formato como DATO, no como código', async () => {
    const { records } = await parsePdfBlocks(bytes(), profile, fields);
    assert.equal(records.length, 1);
    const r = normalizeRecord(records[0]!);
    assert.equal(r.code, '3332088');
    assert.equal(r.clientLastName, 'RIOS LAVARDEN BARBARA'); // nombre entero → APELLIDO (C13)
    assert.equal(r.clientFirstName, null);
    assert.equal(r.coHolder, 'MARTINEZ DURAN JUAN ANTONIO');
    assert.equal(r.status, 'VIGENTE');
    assert.equal(r.principalAmount, 859743.98);
    assert.equal(r.outstandingBalance, 841370.06);
    assert.equal(r.interestRate, 7);
    assert.equal(r.currency, 'BOLIVIANOS');
    assert.equal(r.disbursedAt, '2024-06-27');
    assert.equal(r.pastDueAmount, 0);
  });

  it('un PDF SIN preset igual dice qué trae, y ofrece dónde empieza cada registro', async () => {
    // El caso del cliente cuyo formato no conocemos: `recordStart` vacío. Antes devolvía cero
    // columnas y no había salida; ahora lista las etiquetas del documento entero y las
    // repeticiones entre las que está la que abre cada registro.
    const sinPreset = { ...profile, recordStart: '', signature: undefined };
    const { labels, recordStartCandidates } = await parsePdfBlocks(bytes(), sinPreset, fields);

    assert.ok(labels.length > 0, 'sin recordStart tiene que listar igual las etiquetas');
    assert.ok(
      recordStartCandidates.some((c) => c.text === 'Cliente'),
      'la etiqueta que abre el registro tiene que estar entre las candidatas',
    );
    // Nada sin letras (números, guiones) se ofrece como inicio de registro.
    assert.ok(recordStartCandidates.every((c) => /\p{L}/u.test(c.text)));
  });

  it('CALIBRACIÓN mora: Dias Mora vacía → 0, NO confunde con Dias Int (18/31/30)', async () => {
    const { records } = await parsePdfBlocks(bytes(), profile, fields);
    assert.equal(normalizeRecord(records[0]!).daysPastDue, 0);
  });

  // R1 CERRADO por calibración manual (FIELD-RULES §6.5.1). No se puede validar "mora real" con
  // este archivo (VIGENTE, sin mora) NI conseguir otro: el extracto lo emite el banco. Lo que sí
  // se puede probar —y es lo que sostiene la solución— es que la columna CONFIGURADA manda.
  it('la columna configurada manda: Dias Int. da 30 donde Dias Mora da 0', async () => {
    const conInt = { ...fields, daysPastDue: { from: 'Dias Int.', in: 'table' as const } };
    const { records } = await parsePdfBlocks(bytes(), profile, conInt);
    assert.equal(normalizeRecord(records[0]!).daysPastDue, 30); // última fila (15/12/2024)
  });

  it('columna inexistente → null (NO 0): el service no debe pisar la mora existente', async () => {
    const inventada = { ...fields, daysPastDue: { from: 'No Existe', in: 'table' as const } };
    const { records } = await parsePdfBlocks(bytes(), profile, inventada);
    assert.equal(normalizeRecord(records[0]!).daysPastDue, null);
  });

  it('columnCandidates trae Dias Mora y Dias Int. con valores reales para calibrar', async () => {
    const { columnCandidates } = await parsePdfBlocks(bytes(), profile, fields);
    const headers = columnCandidates.map((c) => c.header);
    assert.ok(headers.includes('Dias Mora'), `faltó Dias Mora en ${headers.join(', ')}`);
    assert.ok(headers.includes('Dias Int.'), `faltó Dias Int. en ${headers.join(', ')}`);
    assert.ok(!headers.includes('Saldo Deudor'), 'los montos no son candidatos a "días"');

    const int = columnCandidates.find((c) => c.header === 'Dias Int.')!;
    assert.deepEqual(int.samples, [{ label: 'RIOS LAVARDEN BARBARA', value: 30 }]);
    const mora = columnCandidates.find((c) => c.header === 'Dias Mora')!;
    assert.deepEqual(mora.samples, [{ label: 'RIOS LAVARDEN BARBARA', value: null }]);
  });

  it('detecta las etiquetas del archivo para que el usuario empareje (§6.5)', async () => {
    const { labels } = await parsePdfBlocks(bytes(), profile, fields);
    for (const l of ['Cliente', 'No.Credito', 'Estado', 'Monto', 'Saldo Credito', 'Fecha Desembolso']) {
      assert.ok(labels.includes(l), `faltó la etiqueta "${l}" en: ${labels.join(' · ')}`);
    }
  });

  it('la firma es opcional: sin `signature` lee igual', async () => {
    const { records } = await parsePdfBlocks(bytes(), { ...profile, signature: undefined }, fields);
    assert.equal(records.length, 1);
  });

  it('firma que no coincide → SIGNATURE_MISMATCH', async () => {
    await assert.rejects(
      () => parsePdfBlocks(bytes(), { ...profile, signature: ['OTRO BANCO'] }, fields),
      /SIGNATURE_MISMATCH/,
    );
  });

  it('un recordStart que no existe no rompe: devuelve 0 registros', async () => {
    const { records } = await parsePdfBlocks(bytes(), { ...profile, recordStart: 'Inexistente' }, fields);
    assert.equal(records.length, 0); // el service lo traduce a NO_RECORDS_MAPPED y manda a Ajustes
  });
});
