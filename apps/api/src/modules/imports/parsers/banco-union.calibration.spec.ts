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

  // R1: cerrar antes de mergear FUNDACION — validar con un extracto con mora real
  // (Estado≠VIGENTE, Moratorios>0) que un valor real cae bajo la X de `Dias Mora`.
  it.todo('daysPastDue > 0 contra un extracto con mora real');
});
