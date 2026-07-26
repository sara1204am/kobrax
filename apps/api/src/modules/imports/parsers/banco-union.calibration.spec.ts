import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseBancoUnionPdf } from './banco-union.parser';

// Muestra real: extracto Banco Unión PRR0785A, VIGENTE, mora 0 (docs/flows/).
const here = dirname(fileURLToPath(import.meta.url));
const PDF = resolve(here, '../../../../../../docs/flows/mora union.PDF');

describe('banco-union.parser — calibración (muestra VIGENTE)', () => {
  it('extrae la cabecera del bloque de crédito', async () => {
    const { template, blocks } = await parseBancoUnionPdf(new Uint8Array(readFileSync(PDF)));
    assert.equal(template, 'banco-union-pdf');
    assert.equal(blocks.length, 1);
    const b = blocks[0]!;
    assert.equal(b.code, '3332088');
    assert.equal(b.clientName, 'RIOS LAVARDEN BARBARA');
    assert.equal(b.coHolder, 'MARTINEZ DURAN JUAN ANTONIO');
    assert.equal(b.status, 'VIGENTE');
    assert.equal(b.principalAmount, 859743.98);
    assert.equal(b.outstandingBalance, 841370.06);
    assert.equal(b.interestRate, 7);
    assert.equal(b.currency, 'BOLIVIANOS');
    assert.equal(b.disbursedAt, '2024-06-27');
    assert.equal(b.branchLabel, 'SUCRE');
  });

  it('CALIBRACIÓN mora: columna Dias Mora vacía → 0, NO confunde con Dias Int (18/31/30)', async () => {
    const { blocks } = await parseBancoUnionPdf(new Uint8Array(readFileSync(PDF)));
    assert.equal(blocks[0]!.daysPastDue, 0);
  });

  // R1 CERRADO por calibración manual (FIELD-RULES §6.5.1). No se puede validar "mora real" con
  // este archivo (VIGENTE, sin mora) NI conseguir otro: el extracto lo emite el banco. Lo que sí
  // se puede probar —y es lo que sostiene la solución— es que la columna CONFIGURADA manda: si
  // el usuario elige la equivocada, el número cambia. Eso es exactamente lo que le mostramos.
  it('la columna configurada manda: Dias Int. da 30 donde Dias Mora da 0', async () => {
    // Bytes frescos por llamada: pdfjs se queda con el buffer (lo deja detached) al parsear.
    const mora = await parseBancoUnionPdf(new Uint8Array(readFileSync(PDF))); // default = Dias Mora
    const int = await parseBancoUnionPdf(new Uint8Array(readFileSync(PDF)), {
      daysPastDueColumn: 'Dias Int.',
    });
    assert.equal(mora.blocks[0]!.daysPastDue, 0);
    assert.equal(int.blocks[0]!.daysPastDue, 30); // última fila de movimiento (15/12/2024)
  });

  it('columna inexistente → null (NO 0): el service no debe pisar la mora existente', async () => {
    const { blocks } = await parseBancoUnionPdf(new Uint8Array(readFileSync(PDF)), {
      daysPastDueColumn: 'Columna Que No Existe',
    });
    assert.equal(blocks[0]!.daysPastDue, null);
  });

  it('columnCandidates ofrece Dias Mora y Dias Int. con valores reales y nombre del cliente', async () => {
    const { columnCandidates } = await parseBancoUnionPdf(new Uint8Array(readFileSync(PDF)));
    const headers = columnCandidates.map((c) => c.header);
    assert.ok(headers.includes('Dias Mora'), `faltó Dias Mora en ${headers.join(', ')}`);
    assert.ok(headers.includes('Dias Int.'), `faltó Dias Int. en ${headers.join(', ')}`);
    // Los montos no son candidatos a "días": tienen decimales.
    assert.ok(!headers.includes('Saldo Deudor'), 'Saldo Deudor no debería ser candidata');

    const int = columnCandidates.find((c) => c.header === 'Dias Int.')!;
    assert.deepEqual(int.samples, [{ clientName: 'RIOS LAVARDEN BARBARA', value: 30 }]);
    const mora = columnCandidates.find((c) => c.header === 'Dias Mora')!;
    assert.deepEqual(mora.samples, [{ clientName: 'RIOS LAVARDEN BARBARA', value: null }]);
  });

  it('extrae Moratorios → pastDueAmount (0, no null: la columna existe y está en cero)', async () => {
    const { blocks } = await parseBancoUnionPdf(new Uint8Array(readFileSync(PDF)));
    assert.equal(blocks[0]!.pastDueAmount, 0);
  });
});
