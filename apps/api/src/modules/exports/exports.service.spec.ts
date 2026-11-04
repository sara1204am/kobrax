import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { ExportsService } from './exports.service';
import { MORA_CSV_COLUMNS } from '../mora/mora-export';

/**
 * F4/08 · fase 3 — la exportación de mora exporta créditos en mora, con las columnas de la
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
    client: { findMany: async () => [] },
    creditActivity: { findMany: async () => [{ id: 'a1', creditId: 'cr1', type: 'CALL' }] },
    creditArrearEpisode: { findMany: async () => [{ id: 'e1', creditId: 'cr1' }] },
    payment: { findMany: async () => [] },
    agendaItem: { findMany: async () => [] },
  };
  const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
  const tenant = { accountId: 'acc-A', userId: 'u1', can: () => true };
  const audit = { record: async (e: { entity: string; action: string }) => void audited.push(e) };
  const service = new ExportsService(prisma as never, tenant as never, {} as never, audit as never, { assignScope: async () => ({ kind: 'ALL', paths: [] }) } as never);
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

  it('se audita como export:mora', async () => {
    const a = make();
    await a.service.moraCsv();
    assert.deepEqual(a.audited.map((e) => e.entity), ['export:mora']);
  });
});

describe('ExportsService.fullBackup', () => {
  it('incluye las gestiones de credit_activities y los episodios de mora', async () => {
    const { service, tx } = make();
    (tx.client as { findMany: () => Promise<unknown[]> }).findMany = async () => [];
    (tx.credit as { findMany: () => Promise<unknown[]> }).findMany = async () => [];
    const file = await service.fullBackup();
    const json = JSON.parse(gunzipSync(file.content).toString('utf-8')) as Record<string, unknown[]>;
    assert.deepEqual(json.activities, [{ id: 'a1', creditId: 'cr1', type: 'CALL' }]);
    assert.equal(json.arrearEpisodes!.length, 1);
    assert.equal('cases' in json, false, 'el caso ya no existe'); 
  });
});

/** D-7 (F13): los exportes se acotan por oficina; el backup es sólo de toda la cuenta. */
describe('ExportsService — alcance por oficina (D-7)', () => {
  function makeScoped(can: (p: string) => boolean, assign: 'ALL' | 'OFFICES') {
    const wheres: Record<string, Record<string, unknown>> = {};
    let raw = 0;
    const rec = (k: string) => async (a: { where: Record<string, unknown> }) => {
      wheres[k] ??= a.where; // la primera consulta de cada tabla (agendaCsv hace otra a clients)
      return [];
    };
    const tx = {
      $queryRaw: async () => {
        raw += 1;
        return [{ id: 'v1' }];
      },
      account: { findUnique: async () => ({ configuration: {} }) },
      arrearCategory: { findMany: async () => [] },
      credit: { findMany: rec('credit') },
      client: { findMany: rec('client') },
      clientLocation: { findMany: rec('location') },
      agendaItem: { findMany: rec('agenda') },
      profile: { findMany: async () => [] },
      creditActivity: { findMany: async () => [] },
      creditArrearEpisode: { findMany: async () => [] },
      payment: { findMany: async () => [] },
    };
    const prisma = { withTenant: async (_a: string, fn: (t: typeof tx) => Promise<unknown>) => fn(tx) };
    const audit = { record: async () => undefined };
    const office = { assignScope: async () => ({ kind: assign, paths: [] }) };
    const service = new ExportsService(prisma as never, { accountId: 'acc-A', userId: 'u1', can } as never, {} as never, audit as never, office as never);
    return { service, wheres, raw: () => raw };
  }
  const branch = (p: string) => p === 'data:scope:branch';
  const all = (p: string) => p === 'data:scope:all';

  it('ALL: ningún CSV filtra por ids y no corre SQL crudo', async () => {
    const { service, wheres, raw } = makeScoped(all, 'ALL');
    await service.clientsCsv();
    await service.locationsCsv();
    await service.moraCsv();
    await service.agendaCsv();
    assert.equal(raw(), 0);
    assert.equal('id' in wheres.client!, false);
    assert.equal('clientId' in wheres.location!, false);
    assert.equal('id' in wheres.credit!, false);
    assert.equal('creditId' in wheres.agenda!, false);
  });

  it('no-ALL: clientes, ubicaciones, mora y agenda se acotan a lo visible', async () => {
    const { service, wheres } = makeScoped(branch, 'OFFICES');
    await service.clientsCsv();
    await service.locationsCsv();
    await service.moraCsv();
    await service.agendaCsv();
    assert.deepEqual(wheres.client!.id, { in: ['v1'] });
    assert.deepEqual(wheres.location!.clientId, { in: ['v1'] });
    assert.deepEqual(wheres.credit!.id, { in: ['v1'] });
    assert.deepEqual(wheres.agenda!.creditId, { in: ['v1'] });
  });

  it('backup: 403 EXPORT_BACKUP_FORBIDDEN fuera de «toda la cuenta»; ALL (o subárbol en la raíz) sí', async () => {
    await assert.rejects(makeScoped(branch, 'OFFICES').service.fullBackup(), (e: unknown) => (e as { response?: { code?: string } }).response?.code === 'EXPORT_BACKUP_FORBIDDEN');
    const ok = await makeScoped(all, 'ALL').service.fullBackup();
    assert.equal(ok.filename, 'backup-cuenta.json.gz');
  });
});
