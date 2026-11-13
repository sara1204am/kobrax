/**
 * F13 · R-7 — importación: la oficina de los créditos nuevos la DERIVA el servidor y una re-importación no la cambia.
 *
 * Usa los reportes reales del asesor CQE (`docs/flows/psf-diario`) sobre la cuenta demo (dos agencias: Central y El Alto).
 *
 *   pnpm --filter @kobrax/api build && pnpm --filter @kobrax/api test:integration
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { PortfolioSummary } from '@kobrax/shared';
import { call, db, freshDatabase, importReport, login, startApi, stopApi } from './harness';

const importConfig = JSON.parse(readFileSync(join(__dirname, 'fixtures/psf-import-config.json'), 'utf8')) as object;
const R28 = 'Reporte_Mora_20260928_CQE.pdf';
const R29 = 'Reporte_Mora_20260929_CQE.pdf';

let prisma: PrismaClient;
let accountId: string;
let juan: string;
let tokenJuan: string;
let tokenManager: string;
const branch: Record<'CEN' | 'ALT', string> = { CEN: '', ALT: '' };

describe('R-7 · importación: oficina derivada por el servidor, re-importación estable', { timeout: 600_000 }, () => {
  before(async () => {
    await freshDatabase();
    prisma = db();
    const collector = await prisma.user.findUniqueOrThrow({ where: { email: 'collector@kobrax.demo' }, include: { userAccounts: true } });
    accountId = collector.userAccounts[0]!.accountId;
    juan = collector.id;
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.account.update({ where: { id: accountId }, data: { configuration: { ...((account.configuration as object) ?? {}), importConfig } } });
    await prisma.externalAdvisorLink.upsert({
      where: { accountId_externalSource_advisorCode: { accountId, externalSource: 'PSF', advisorCode: 'CQE' } },
      update: { userId: juan, deletedAt: null },
      create: { accountId, externalSource: 'PSF', advisorCode: 'CQE', userId: juan },
    });
    for (const code of ['CEN', 'ALT'] as const) {
      branch[code] = (await prisma.branch.findFirstOrThrow({ where: { accountId, code, deletedAt: null } })).id;
    }
    await startApi();
    tokenJuan = await login('collector@kobrax.demo');
    tokenManager = await login('manager@kobrax.demo');
  });

  after(async () => {
    stopApi();
    await prisma?.$disconnect();
  });

  it('🔴 el cobrador importa su cartera: cada crédito NUEVO queda en la oficina de su responsable (Central), nunca sin oficina', async () => {
    const res = await importReport<PortfolioSummary>(tokenJuan, R28);
    assert.equal(res.status, 201, JSON.stringify(res.error));
    assert.ok(res.data!.counts.created > 0);
    const nuevos = await prisma.credit.findMany({ where: { accountId, externalSource: 'PSF', lastSeenRunId: { not: null }, createdAt: { gte: new Date(Date.now() - 600_000) } }, select: { branchId: true, assignedManagerId: true } });
    assert.ok(nuevos.length > 0);
    const propios = nuevos.filter((c) => c.assignedManagerId === juan);
    assert.ok(propios.length > 0);
    assert.ok(propios.every((c) => c.branchId === branch.CEN), 'la oficina la decide el servidor: la del responsable');
    assert.equal(await prisma.credit.count({ where: { accountId, deletedAt: null, branchId: null } }), 0, 'ningún crédito de la cuenta quedó sin oficina');
  });

  it('🔴 re-importar NO cambia la oficina de un crédito existente (aunque se lo haya movido)', async () => {
    const antes = await prisma.credit.findMany({ where: { accountId, externalSource: 'PSF', assignedManagerId: juan }, select: { id: true, branchId: true } });
    const elegido = antes[0]!;
    // Se lo pasa a El Alto con la acción de reasignación (la única vía), y se vuelve a importar.
    const mover = await call(tokenManager, 'POST', '/credits/reassign-office', { creditIds: [elegido.id], toBranchId: branch.ALT });
    assert.equal(mover.status, 200, JSON.stringify(mover.error));
    const res = await importReport<PortfolioSummary>(tokenJuan, R29);
    assert.equal(res.status, 201, JSON.stringify(res.error));
    const despues = await prisma.credit.findMany({ where: { id: { in: antes.map((c) => c.id) } }, select: { id: true, branchId: true } });
    const byId = new Map(despues.map((c) => [c.id, c.branchId]));
    assert.equal(byId.get(elegido.id), branch.ALT, 'el movido sigue donde lo dejó la reasignación');
    for (const c of antes.filter((x) => x.id !== elegido.id)) assert.equal(byId.get(c.id), c.branchId, 'los demás no cambiaron');
  });
});
