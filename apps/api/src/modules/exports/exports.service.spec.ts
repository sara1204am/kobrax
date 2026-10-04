import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { ExportsService } from './exports.service';
import { MORA_CSV_COLUMNS } from '../mora/mora-export';

/**
 * F4/08 · fase 3 — la exportación `cases` pasó a exportar créditos en mora (alias de `mora`), con las columnas de la
 * Central de Mora; el backup lleva las gestiones de `credit_activities`.
 */
function make() {
  const audited: { entity: string; action: string }[] = [];
  const queries: Record<string, unknown>[] = [];
  const credit = {
    id: 'cr1',
    code: 'C-001',
    clientId: 'cl1',
    currency: 'BOB',
    outstandingBalance: 900,
    principalAmount: 1000,
    daysPastDue: 45,
    metadata: { origin: 'manual', moraSince: '2026-08-01' },
    origin: 'MANUAL',
    externalSource: null,
    syncStatus: null,
    reportedAsOf: null,
    absentSince: null,
    writtenOffAt: new Date('2026-09-01'),
    lastActionAt: new Date('2026-10-02T10:00:00Z'),
    assignedManagerId: 'u1',
    branchId: null,
    branch: null,
    client: { firstName: 'Ana', lastName: 'Ríos', businessName: null },
    installments: [],
    arrearEpisodes: [{ priority: 'HIGH', priorityPinnedAt: null }],
    activities: [{ type: 'CALL', result: 'PROMISED' }],
    payments: [],
  };
  const tx = {
    account: { findUnique: async () => ({ configuration: {} }) },
    arrearCategory: {
      findMany: async () => [
        { code: 'A', name: 'A', color: null, fromDays: 1, toDays: 30 },
        { code: 'B', name: 'B', color: null, fromDays: 31, toDays: 60 },
      ],
    },
    credit: {
      findMany: async (args: Record<string, unknown>) => {
        queries.push(args);
        return queries.length === 1 ? [credit] : [];
      },
    },
    profile: { findMany: async () => [{ userId: 'u1', firstName: 'Luis', lastName: 'Paz' }] },
    collectionCase: new Proxy({}, { get: () => () => ({ then: undefined }) }),
    client: { findMany: async () => [] },
    creditActivity: { findMany: async () => [{ id: 'a1', creditId: 'cr1', type: 'CALL' }] },
    creditArrearEpisode: { findMany: async () => [{ id: 'e1', creditId: 'cr1' }] },
    payment: { findMany: async () => [] },
    agendaItem: { findMany: async () => [] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A' };
  const audit = { record: async (e: { entity: string; action: string }) => void audited.push(e) };
  const service = new ExportsService(prisma as never, tenant as never, {} as never, audit as never);
  return { service, audited, queries, tx };
}

describe('ExportsService.moraCsv', () => {
  it('exporta créditos con episodio abierto, no casos', async () => {
    const { service, queries } = make();
    await service.moraCsv();
    const where = (queries[0] as { where: Record<string, unknown> }).where;
    assert.deepEqual(where.arrearEpisodes, { some: { endedAt: null } });
  });

  it('lleva las columnas de la Central de Mora (sin «Promesa vigente»)', async () => {
    const { service } = make();
    const file = await service.moraCsv();
    const header = file.content.toString('utf-8').replace(/^﻿/, '').split(/\r?\n/)[0]!;
    for (const col of ['Responsable', 'Categoría', 'Situación', 'Castigado', 'Prioridad', 'Días de mora', 'Monto vencido', 'Última gestión']) {
      assert.ok(header.includes(col), `falta la columna ${col}`);
    }
    assert.ok(!header.includes('Promesa vigente'));
    assert.equal(file.filename, 'mora.csv');
    assert.ok(MORA_CSV_COLUMNS.length > 20);
  });

  it('la fila trae responsable por nombre, categoría calculada, castigo y prioridad del episodio', async () => {
    const { service } = make();
    const csv = (await service.moraCsv()).content.toString('utf-8');
    const row = csv.split(/\r?\n/)[1]!;
    assert.ok(row.includes('Luis Paz'), 'responsable por nombre, no por id');
    assert.ok(row.includes('C-001'));
    assert.ok(row.includes('En mora'));
    assert.ok(row.includes('Sí'), 'castigado');
    assert.ok(row.includes('Alta'), 'prioridad del episodio');
    assert.match(row, /,B,/, 'categoría B por 45 días');
  });

  it('se audita como export:mora, también por el alias cases', async () => {
    const a = make();
    await a.service.moraCsv();
    const b = make();
    await b.service.casesCsv();
    assert.deepEqual(a.audited.map((e) => e.entity), ['export:mora']);
    assert.deepEqual(b.audited.map((e) => e.entity), ['export:mora']);
  });

  it('el alias `cases` devuelve lo mismo que `mora`', async () => {
    const a = (await make().service.moraCsv()).content.toString('utf-8');
    const b = (await make().service.casesCsv()).content.toString('utf-8');
    assert.equal(a, b);
  });
});

describe('ExportsService.fullBackup', () => {
  it('incluye las gestiones de credit_activities y los episodios de mora', async () => {
    const { service, tx } = make();
    (tx.client as { findMany: () => Promise<unknown[]> }).findMany = async () => [];
    (tx.credit as { findMany: () => Promise<unknown[]> }).findMany = async () => [];
    // Los casos históricos siguen en el backup hasta la fase 6: el fake los devuelve vacíos.
    (tx as unknown as { collectionCase: { findMany: () => Promise<unknown[]> } }).collectionCase = { findMany: async () => [] };
    const file = await service.fullBackup();
    const json = JSON.parse(gunzipSync(file.content).toString('utf-8')) as Record<string, unknown[]>;
    assert.deepEqual(json.activities, [{ id: 'a1', creditId: 'cr1', type: 'CALL' }]);
    assert.equal(json.arrearEpisodes!.length, 1);
    assert.ok('cases' in json, 'los casos históricos no se pierden hasta la fase 6');
  });
});
