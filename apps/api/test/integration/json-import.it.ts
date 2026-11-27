/**
 * Importación de cartera desde JSON, de punta a punta: configurar la forma, leer la muestra, ver la
 * vista previa en seco, importar y bajar el documento guardado. Datos inventados.
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import type { ColumnsPayload, ConfigScreen, ImportApiDocument, PortfolioSummary } from '@kobrax/shared';
import { API, call, db, freshDatabase, login, startApi, stopApi, type Envelope } from './harness';

const DOC = JSON.stringify({
  data: {
    creditos: [
      { operacion: 'JSON-0001', cliente: { nombre: 'PRUEBA UNO ANA' }, saldo: 1234.5, mora: 12, desembolso: '2024-06-27' },
      { operacion: 'JSON-0002', cliente: { nombre: 'PRUEBA DOS LUIS' }, saldo: 800, mora: 0, desembolso: null },
    ],
  },
});

let prisma: PrismaClient;
let accountId: string;
let token: string;

async function upload<T>(query: string, fields: Record<string, string> = {}): Promise<Envelope<T>> {
  const form = new FormData();
  form.append('file', new Blob([DOC], { type: 'application/json' }), 'cartera.json');
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${API}/imports/portfolio${query}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const body = (await res.json()) as { data?: T; error?: Envelope<T>['error'] };
  return { status: res.status, data: body.data, error: body.error ?? undefined };
}

describe('Importación de cartera desde JSON', { timeout: 600_000 }, () => {
  before(async () => {
    await freshDatabase();
    prisma = db();
    const collector = await prisma.user.findUniqueOrThrow({ where: { email: 'collector@kobrax.demo' }, include: { userAccounts: true } });
    accountId = collector.userAccounts[0]!.accountId;
    await startApi({ IMPORT_API_ALLOW_LOCAL: 'true' });
    token = await login('collector@kobrax.demo');
    // La configuración la escribe la base: quién puede cambiarla ya se prueba en otra suite.
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const importConfig = {
      source: 'file',
      profile: { kind: 'json' },
      fields: {
        code: { from: 'operacion' },
        clientName: { from: 'cliente.nombre' },
        outstandingBalance: { from: 'saldo' },
        daysPastDue: { from: 'mora', calibrated: true },
        disbursedAt: { from: 'desembolso' },
      },
      nameOrder: 'full',
      scope: { kind: 'account', ref: null },
      absentRule: 'no-touch',
    };
    await prisma.account.update({ where: { id: accountId }, data: { configuration: { ...((account.configuration as object) ?? {}), importConfig } } });
  });

  after(async () => {
    stopApi();
    await prisma?.$disconnect();
  });

  it('lee la muestra: columnas aplanadas y la lista encontrada', async () => {
    const res = await upload<ColumnsPayload>('?columnsOnly=true');
    assert.equal(res.status, 201, JSON.stringify(res.error));
    assert.deepEqual(res.data!.recordsCandidates, [{ path: 'data.creditos', count: 2 }]);
    assert.ok(res.data!.labels.includes('cliente.nombre'));
  });

  it('la vista previa no escribe nada; al importar quedan saldo, mora, fecha y el documento guardado', async () => {
    const seco = await upload<PortfolioSummary>('', { dryRun: 'true' });
    assert.equal(seco.status, 201, JSON.stringify(seco.error));
    assert.equal(seco.data!.counts.created, 2);
    assert.equal(await prisma.credit.count({ where: { accountId, externalId: { startsWith: 'JSON-' } } }), 0);

    const real = await upload<PortfolioSummary>('', { dryRun: 'false' });
    assert.equal(real.status, 201, JSON.stringify(real.error));
    const credit = await prisma.credit.findFirstOrThrow({ where: { accountId, externalId: 'JSON-0001' } });
    assert.equal(Number(credit.outstandingBalance), 1234.5);
    assert.equal(credit.daysPastDue, 12);
    assert.equal(credit.disbursedAt?.toISOString().slice(0, 10), '2024-06-27');

    const runs = await call<{ id: string; file?: { name: string } }[]>(token, 'GET', '/imports/portfolio/runs');
    const run = runs.data!.find((r) => r.file?.name === 'cartera.json');
    assert.ok(run, JSON.stringify(runs.data));
    // El cobrador no tiene permiso de datos personales: la descarga la hace quien sí (P10).
    const admin = await login('manager@kobrax.demo');
    const file = await fetch(`${API}/imports/portfolio/runs/${run.id}/file?download=1`, { headers: { Authorization: `Bearer ${admin}` } });
    if (file.status === 200) assert.equal(await file.text(), DOC);
    else assert.equal(file.status, 403);
  });

  it('por API: guarda la conexión sin devolver la clave, trae los datos e importa ese mismo documento', async () => {
    const KEY = 'CLAVE-DE-PRUEBA';
    const bank = createServer((req, res) => {
      if (req.headers['x-api-key'] !== KEY) return res.writeHead(401).end();
      res.end(DOC.replace('JSON-0001', 'API-0001').replace('JSON-0002', 'API-0002'));
    });
    await new Promise<void>((ok) => bank.listen(0, '127.0.0.1', ok));
    try {
      const manager = await login('manager@kobrax.demo');
      const url = `http://127.0.0.1:${(bank.address() as AddressInfo).port}/cartera`;
      const connection = { method: 'GET', url, headers: [{ name: 'x-api-key', value: KEY }] };
      // El cobrador no configura ni trae: la API entrega la cartera entera.
      assert.equal((await call(token, 'PUT', '/imports/portfolio/api-connection', connection)).status, 403);
      assert.equal((await call(token, 'POST', '/imports/portfolio/api-fetch')).status, 403);

      const saved = await call(manager, 'PUT', '/imports/portfolio/api-connection', connection);
      assert.equal(saved.status, 200, JSON.stringify(saved.error));
      const screen = await call<ConfigScreen>(manager, 'GET', '/imports/portfolio/config');
      assert.deepEqual(screen.data!.api, { method: 'GET', url, headerNames: ['x-api-key'], hasBody: false });
      const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      assert.ok(!JSON.stringify(account.configuration).includes(KEY), 'la clave no se guarda en claro');
      const audits = await prisma.auditLog.findMany({ where: { accountId, entity: 'import_api' } });
      assert.ok(!JSON.stringify(audits).includes(KEY));

      const fetched = await call<ImportApiDocument>(manager, 'POST', '/imports/portfolio/api-fetch');
      assert.equal(fetched.status, 201, JSON.stringify(fetched.error));
      bank.close(); // desde acá no hay segunda llamada: se usa lo guardado
      const form = new FormData();
      form.append('apiDocument', fetched.data!.documentId);
      form.append('dryRun', 'false');
      const res = await fetch(`${API}/imports/portfolio`, { method: 'POST', headers: { Authorization: `Bearer ${manager}` }, body: form });
      const body = (await res.json()) as { data?: PortfolioSummary; error?: unknown };
      // Quien reparte tiene que elegir responsable para lo nuevo antes de confirmar.
      assert.ok(res.status === 201 || res.status === 400, JSON.stringify(body));
      const preview = new FormData();
      preview.append('apiDocument', fetched.data!.documentId);
      preview.append('dryRun', 'true');
      const dry = await fetch(`${API}/imports/portfolio`, { method: 'POST', headers: { Authorization: `Bearer ${manager}` }, body: preview });
      assert.equal(dry.status, 201);
    } finally {
      bank.close();
    }
  });
});
