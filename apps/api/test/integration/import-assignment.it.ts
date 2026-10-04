/**
 * Responsables al importar: los 12 escenarios del plan (P8), contra la base y la API reales.
 *
 *   pnpm --filter @kobrax/api test:integration
 *
 * Usa los reportes reales del asesor CQE (`docs/flows/psf-diario`, del 28/09 al 02/10) en orden de
 * fecha de corte —un reporte más viejo no pisa uno más nuevo (D9)— y cada escenario deja la base
 * como la necesita el siguiente. Por eso van en un solo `describe` y en este orden.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import type { PortfolioSummary } from '@kobrax/shared';
import { addMember, call, db, freshDatabase, importReport, login, startApi, stopApi } from './harness';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** La configuración del formato PSF del asesor CQE, como quedó en la cuenta demo de desarrollo. */
const importConfig = JSON.parse(readFileSync(join(__dirname, 'fixtures/psf-import-config.json'), 'utf8')) as object;

const R28 = 'Reporte_Mora_20260928_CQE.pdf';
const R29 = 'Reporte_Mora_20260929_CQE.pdf';
const R30 = 'Reporte_Mora_20260930_CQE.pdf';
const R01 = 'Reporte_Mora_20261001_CQE.pdf';
const R02 = 'Reporte_Mora_20261002_CQE.pdf';

let prisma: PrismaClient;
let accountId: string;
const id: Record<'juan' | 'pedro' | 'manager' | 'supervisor', string> = { juan: '', pedro: '', manager: '', supervisor: '' };
const token: Record<'juan' | 'pedro' | 'manager', string> = { juan: '', pedro: '', manager: '' };

/** Vincula el código de asesor CQE a un usuario: de quién es la cartera de esos reportes (D8). */
async function linkCqe(userId: string): Promise<void> {
  await prisma.externalAdvisorLink.upsert({
    where: { accountId_externalSource_advisorCode: { accountId, externalSource: 'PSF', advisorCode: 'CQE' } },
    update: { userId, deletedAt: null },
    create: { accountId, externalSource: 'PSF', advisorCode: 'CQE', userId },
  });
}

/** Responsable de un crédito por nº de operación, en las DOS mitades: columna y permanente vigente. */
async function owner(code: string): Promise<{ column: string | null; table: string[] }> {
  const credit = await prisma.credit.findFirstOrThrow({ where: { accountId, externalId: code } });
  const rows = await prisma.creditAssignment.findMany({
    where: { creditId: credit.id, revokedAt: null, expiresAt: null, caseId: null },
    select: { userId: true },
  });
  return { column: credit.assignedManagerId, table: rows.map((r) => r.userId) };
}

/** El chequeo de `db:audit:assignments`: ningún crédito con tabla y columna en desacuerdo. */
async function desync(): Promise<number> {
  const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM credits c
    WHERE c.deleted_at IS NULL AND c.account_id = ${accountId}
      AND c.assigned_manager_id IS DISTINCT FROM (
        SELECT ca.user_id FROM credit_assignments ca
        WHERE ca.credit_id = c.id AND ca.revoked_at IS NULL AND ca.expires_at IS NULL AND ca.case_id IS NULL)`;
  return Number(n);
}

describe('Importación de cartera — quién queda responsable', { timeout: 600_000 }, () => {
  before(async () => {
    await freshDatabase();
    prisma = db();
    const collector = await prisma.user.findUniqueOrThrow({ where: { email: 'collector@kobrax.demo' }, include: { userAccounts: true } });
    accountId = collector.userAccounts[0]!.accountId;
    id.juan = collector.id;
    id.manager = (await prisma.user.findUniqueOrThrow({ where: { email: 'manager@kobrax.demo' } })).id;
    id.supervisor = (await prisma.user.findUniqueOrThrow({ where: { email: 'supervisor@kobrax.demo' } })).id;
    id.pedro = await addMember(prisma, accountId, 'pedro@kobrax.demo', 'Pedro', 'COLLECTOR');
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.account.update({
      where: { id: accountId },
      data: { configuration: { ...((account.configuration as object) ?? {}), importConfig } },
    });
    await linkCqe(id.juan);

    await startApi();
    token.juan = await login('collector@kobrax.demo');
    token.pedro = await login('pedro@kobrax.demo');
    token.manager = await login('manager@kobrax.demo');
  });

  after(async () => {
    stopApi();
    await prisma?.$disconnect();
  });

  it('2 · un cobrador NO importa la cartera de otro asesor (CQE es de Juan)', async () => {
    // El seed ya trae un par de créditos PSF de ejemplo: lo que importa es que no aparezca ninguno más.
    const antes = await prisma.credit.count({ where: { accountId, externalSource: 'PSF' } });
    const res = await importReport<PortfolioSummary>(token.pedro, R28);
    assert.equal(res.status, 403);
    assert.equal(res.error?.code, 'ADVISOR_BELONGS_TO_OTHER');
    assert.match(res.error!.message, /Juan|Carlos|Collector/, 'dice de quién es la cartera');
    assert.equal(await prisma.credit.count({ where: { accountId, externalSource: 'PSF' } }), antes, 'no se escribió nada');
  });

  it('1 · el cobrador importa SU cartera: los nuevos quedan a su nombre, sin elegir nada', async () => {
    const preview = await importReport<PortfolioSummary>(token.juan, R28, { dryRun: true });
    assert.equal(preview.data?.assignment?.mode, 'SELF');
    assert.ok(preview.data!.preview.toCreate.every((r) => r.suggestedAssigneeId === id.juan));

    const res = await importReport<PortfolioSummary>(token.juan, R28);
    assert.equal(res.status, 201, JSON.stringify(res.error));
    assert.ok(res.data!.counts.created > 0);
    const code = res.data!.preview.toCreate[0]!.code;
    assert.deepEqual(await owner(code), { column: id.juan, table: [id.juan] });
  });

  it('el cobrador tampoco puede mandar asignaciones (ni siquiera a sí mismo)', async () => {
    const res = await importReport(token.juan, R29, { assignments: { version: 1, create: [{ userId: id.juan, externalIds: ['x'] }] } });
    assert.equal(res.status, 403);
    assert.equal(res.error?.code, 'ASSIGNMENT_FORBIDDEN');
  });

  it('3 + 7 · el gerente se asigna los nuevos a sí mismo; los existentes conservan su responsable', async () => {
    const preview = await importReport<PortfolioSummary>(token.manager, R29, { dryRun: true });
    assert.equal(preview.data?.assignment?.mode, 'CHOOSE');
    const nuevos = preview.data!.preview.toCreate.map((r) => r.code);
    const existente = preview.data!.preview.toUpdate[0]!;
    assert.equal(existente.currentAssigneeId, id.juan);

    const res = await importReport<PortfolioSummary>(token.manager, R29, {
      assignments: { version: 1, create: [{ userId: id.manager, externalIds: nuevos }] },
    });
    assert.equal(res.status, 201, JSON.stringify(res.error));
    for (const code of nuevos) assert.deepEqual(await owner(code), { column: id.manager, table: [id.manager] });
    assert.deepEqual(await owner(existente.code), { column: id.juan, table: [id.juan] }, 'el existente sigue con Juan');
  });

  it('4 + 5 · el gerente reparte los nuevos entre dos cobradores', async () => {
    const preview = await importReport<PortfolioSummary>(token.manager, R30, { dryRun: true });
    const nuevos = preview.data!.preview.toCreate.map((r) => r.code);
    assert.ok(nuevos.length >= 2, 'el reporte del 30 trae varios nuevos');
    const [paraJuan, paraPedro] = [nuevos.slice(0, 2), nuevos.slice(2)];

    const res = await importReport<PortfolioSummary>(token.manager, R30, {
      assignments: {
        version: 1,
        create: [
          { userId: id.juan, externalIds: paraJuan },
          { userId: id.pedro, externalIds: paraPedro },
        ],
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.error));
    for (const code of paraJuan) assert.equal((await owner(code)).column, id.juan);
    for (const code of paraPedro) assert.equal((await owner(code)).column, id.pedro);
    assert.deepEqual(
      res.data!.assigned!.sort((a, b) => a.userId.localeCompare(b.userId)),
      [
        { userId: id.juan, count: paraJuan.length },
        { userId: id.pedro, count: paraPedro.length },
      ].sort((a, b) => a.userId.localeCompare(b.userId)),
    );
  });

  it('6 · un nuevo sin responsable no se confirma (la sugerencia no sirve: CQE vinculado a un supervisor)', async () => {
    await linkCqe(id.supervisor);
    try {
      const preview = await importReport<PortfolioSummary>(token.manager, R01, { dryRun: true });
      assert.ok(preview.data!.preview.toCreate.every((r) => r.suggestedAssigneeId === null));
      const res = await importReport(token.manager, R01);
      assert.equal(res.status, 400);
      assert.equal(res.error?.code, 'UNASSIGNED_NEW_CREDITS');
    } finally {
      await linkCqe(id.juan);
    }
  });

  it('8 + 9 + 10 · reasignar un existente es explícito, queda auditado y NO mueve el caso abierto', async () => {
    const preview = await importReport<PortfolioSummary>(token.manager, R01, { dryRun: true });
    const target = preview.data!.preview.toUpdate.find((r) => r.currentAssigneeId === id.juan)!;
    assert.ok(target, 'hay un existente de Juan para reasignar');
    // Un caso abierto a cargo de Juan sobre ese crédito.
    const credit = await prisma.credit.findFirstOrThrow({ where: { accountId, externalId: target.code } });
    await prisma.collectionCase.updateMany({ where: { creditId: credit.id }, data: { deletedAt: new Date() } });
    const kase = await prisma.collectionCase.create({
      data: { accountId, creditId: credit.id, clientId: credit.clientId, assigneeId: id.juan, status: 'ACTIVE', priority: 'MEDIUM' },
    });

    const res = await importReport<PortfolioSummary>(token.manager, R01, {
      assignments: { version: 1, reassign: [{ externalId: target.code, fromUserId: id.juan, toUserId: id.pedro }] },
    });
    assert.equal(res.status, 201, JSON.stringify(res.error));
    assert.equal(res.data!.reassigned, 1);
    assert.deepEqual(await owner(target.code), { column: id.pedro, table: [id.pedro] });

    // 9 · la permanente de Juan queda revocada (historial) y hay un REASSIGN con la corrida.
    const historial = await prisma.creditAssignment.findMany({ where: { creditId: credit.id }, orderBy: { createdAt: 'asc' } });
    assert.ok(historial.some((h) => h.userId === id.juan && h.revokedAt !== null));
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'credit', entityId: credit.id, action: 'REASSIGN' } });
    assert.ok(audit, 'quedó auditado');
    assert.equal((audit!.after as { runId?: string }).runId, res.data!.runId);

    // 10 · el caso sigue con su cobrador.
    assert.equal((await prisma.collectionCase.findUniqueOrThrow({ where: { id: kase.id } })).assigneeId, id.juan);
  });

  it('reasignar con un responsable desactualizado → ASSIGNMENT_CONFLICT y la corrida no se aplica', async () => {
    const preview = await importReport<PortfolioSummary>(token.manager, R02, { dryRun: true });
    const target = preview.data!.preview.toUpdate.find((r) => r.currentAssigneeId === id.pedro)!;
    const res = await importReport(token.manager, R02, {
      // La pantalla «vio» a Juan, pero hoy es de Pedro.
      assignments: { version: 1, reassign: [{ externalId: target.code, fromUserId: id.juan, toUserId: id.manager }] },
    });
    assert.equal(res.status, 409);
    assert.equal(res.error?.code, 'ASSIGNMENT_CONFLICT');
    assert.equal(await prisma.clientImportRun.count({ where: { accountId, reportAsOf: new Date('2026-10-02') } }), 0, 'nada a medias');
  });

  it('11 · sin assignment:write no se cambia el responsable llamando al API directo', async () => {
    const credit = await prisma.credit.findFirstOrThrow({ where: { accountId, assignedManagerId: id.juan, deletedAt: null } });
    const cobrador = await call(token.juan, 'PATCH', `/credits/${credit.id}`, { assignedManagerId: id.pedro });
    assert.equal(cobrador.status, 403);
    assert.equal(cobrador.error?.code, 'ASSIGNMENT_FORBIDDEN');
    assert.equal((await owner(credit.externalId!)).column, id.juan);

    const gerente = await call(token.manager, 'PATCH', `/credits/${credit.id}`, { assignedManagerId: id.pedro });
    assert.equal(gerente.status, 200, JSON.stringify(gerente.error));
    assert.deepEqual(await owner(credit.externalId!), { column: id.pedro, table: [id.pedro] });
  });

  it('12 · el mismo archivo otra vez: la vista previa lo avisa, con asignaciones es 409, sin ellas no hace nada', async () => {
    const preview = await importReport<PortfolioSummary>(token.manager, R01, { dryRun: true });
    assert.ok(preview.data?.alreadyApplied, 'la vista previa avisa');

    const conAsignaciones = await importReport(token.manager, R01, {
      assignments: { version: 1, reassign: [{ externalId: preview.data!.preview.toUpdate[0]!.code, fromUserId: null, toUserId: id.juan }] },
    });
    assert.equal(conAsignaciones.status, 409);
    assert.equal(conAsignaciones.error?.code, 'ALREADY_APPLIED');

    const sin = await importReport<PortfolioSummary>(token.manager, R01);
    assert.equal(sin.status, 201);
    assert.equal(sin.data?.idempotentSkip, true);
  });

  it('al final, tabla y columna dicen lo mismo en todos los créditos', async () => {
    assert.equal(await desync(), 0);
  });
});
