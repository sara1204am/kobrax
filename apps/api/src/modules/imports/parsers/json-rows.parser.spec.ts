import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseJsonRows } from './json-rows.parser';
import { normalizeRecord, toIso } from '../field-catalog';

const DOC = JSON.stringify({
  status: 'ok',
  data: {
    creditos: [
      {
        operacion: '302-222-1515',
        cliente: { nombre: 'QUISPE MAMANI ROSA', telefonos: ['70000001', '70000002'] },
        saldo: 12500.567,
        mora: 45,
        desembolso: '2024-06-27T00:00:00Z',
      },
      { operacion: 90211, cliente: { nombre: 'VARGAS LEON JULIO' }, saldo: '8.300,50', mora: 0, cuota: null },
    ],
  },
});

const FIELDS = {
  code: { from: 'operacion' },
  clientName: { from: 'cliente.nombre' },
  phone: { from: 'cliente.telefonos' },
  outstandingBalance: { from: 'saldo' },
  daysPastDue: { from: 'mora' },
  installmentAmount: { from: 'cuota' },
  disbursedAt: { from: 'desembolso' },
};

const read = (content = DOC, recordsPath?: string) => parseJsonRows(content, { recordsPath }, FIELDS);

describe('json-rows.parser', () => {
  it('con una sola lista la usa sin preguntar, aplana lo anidado y junta columnas de todos', () => {
    const r = read();
    assert.deepEqual(r.recordsCandidates, [{ path: 'data.creditos', count: 2 }]);
    assert.equal(r.records.length, 2);
    for (const label of ['cliente.nombre', 'cliente.telefonos', 'desembolso', 'cuota'].slice(0, 3)) {
      assert.ok(r.labels.includes(label), label);
    }
    assert.equal(r.records[0]!.phone, '70000001 - 70000002');
  });

  it('un número del JSON se toma exacto; un texto se lee como en un reporte', () => {
    const r = read();
    const [a, b] = r.records.map((rec, i) => normalizeRecord(rec, 'full', r.exactNumbers[i]));
    assert.equal(a!.outstandingBalance, 12500.567);
    assert.equal(a!.disbursedAt, '2024-06-27');
    assert.equal(b!.outstandingBalance, 8300.5);
    assert.equal(b!.code, '90211');
    assert.equal(b!.daysPastDue, 0);
  });

  it('ausente o null no es cero', () => {
    const r = read();
    assert.equal(normalizeRecord(r.records[1]!).installmentAmount, null);
  });

  it('con varias listas no adivina: ofrece y espera', () => {
    const doc = JSON.stringify({ oficinas: [{ id: 1 }], creditos: [{ operacion: 'A1' }, { operacion: 'A2' }] });
    const pending = read(doc);
    assert.deepEqual(pending.labels, []);
    assert.equal(pending.recordsCandidates[0]!.path, 'creditos');
    assert.equal(read(doc, 'creditos').records.length, 2);
  });

  it('acepta un documento que es la lista, con BOM', () => {
    assert.equal(read('﻿[{"operacion":"A1"}]', '').records[0]!.code, 'A1');
  });

  it('claves peligrosas son columnas comunes', () => {
    const r = parseJsonRows('[{"__proto__":"x"}]', {}, { code: { from: 'constructor' } });
    assert.deepEqual(r.labels, ['__proto__']);
    assert.equal(r.records[0]!.code, null);
  });

  it('rechaza lo que no es JSON y los enteros que ya llegaron redondeados', () => {
    assert.throws(() => read('NRO,DEUDOR'), /no es un JSON/);
    assert.throws(() => read('[{"operacion":30222215150000000001}]'), /demasiado largo/);
  });
});

describe('toIso — fechas ISO', () => {
  it('acepta ISO y rechaza fechas que no existen', () => {
    assert.equal(toIso('2024-06-27'), '2024-06-27');
    assert.equal(toIso('2024-06-27 13:00:00'), '2024-06-27');
    assert.equal(toIso('2024-02-31'), null);
    assert.equal(toIso('0000-00-00'), null);
  });
});
