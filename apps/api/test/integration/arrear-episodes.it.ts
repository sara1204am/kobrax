/**
 * Episodios de mora, por las vías reales: el importador de PSF con los reportes del asesor CQE
 * (28/09 → 02/10) y las acciones manuales de la API, contra la base y la API reales.
 *
 *   pnpm --filter @kobrax/api test:integration
 *
 * El trigger `credits_track_arrear_episode` se prueba escenario por escenario en
 * `packages/database/prisma/verify/arrear_episodes.sql`. Lo que se prueba acá es lo que ese script no
 * puede: que **ninguna** vía de escritura real —el importador, el trabajo diario, las acciones del panel—
 * deje el historial en desacuerdo con el crédito, y que la migración corra de cero (`migrate deploy`) en una
 * base nueva. La invariante es la misma después de cada paso.
 */
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { PortfolioSummary } from '@kobrax/shared';
import { call, db, freshDatabase, importReport, login, startApi, stopApi } from './harness';

const importConfig = JSON.parse(readFileSync(join(__dirname, 'fixtures/psf-import-config.json'), 'utf8')) as object;
const REPORTS = [
  'Reporte_Mora_20260928_CQE.pdf',
  'Reporte_Mora_20260929_CQE.pdf',
  'Reporte_Mora_20260930_CQE.pdf',
  'Reporte_Mora_20261001_CQE.pdf',
  'Reporte_Mora_20261002_CQE.pdf',
];

let prisma: PrismaClient;
let accountId: string;
let token: string;

/** Un crédito está en mora si está vivo, con días y en un estado que no es cerrado. Misma regla que el trigger. */
const EN_MORA = `c.deleted_at IS NULL AND c.days_past_due > 0 AND c.status::text NOT IN ('PAID', 'CANCELLED', 'WRITTEN_OFF')`;

async function count(sql: string): Promise<number> {
  const [row] = await prisma.$queryRawUnsafe<{ n: bigint }[]>(sql);
  return Number(row!.n);
}

/** Las invariantes del historial. Se afirman después de cada paso. */
async function assertInvariantes(paso: string): Promise<void> {
  assert.equal(
    await count(`SELECT count(*) AS n FROM credits c WHERE ${EN_MORA}
      AND NOT EXISTS (SELECT 1 FROM credit_arrear_episodes e WHERE e.credit_id = c.id AND e.ended_at IS NULL)`),
    0,
    `${paso}: hay créditos en mora sin episodio abierto`,
  );
  assert.equal(
    await count(`SELECT count(*) AS n FROM credit_arrear_episodes e JOIN credits c ON c.id = e.credit_id
      WHERE e.ended_at IS NULL AND NOT (${EN_MORA})`),
    0,
    `${paso}: hay episodios abiertos en créditos que no están en mora`,
  );
  assert.equal(
    await count(`SELECT count(*) AS n FROM (SELECT credit_id FROM credit_arrear_episodes WHERE ended_at IS NULL
      GROUP BY credit_id HAVING count(*) > 1) x`),
    0,
    `${paso}: hay créditos con más de un episodio abierto`,
  );
  assert.equal(
    await count(`SELECT count(*) AS n FROM credit_arrear_episodes WHERE max_days_past_due < start_days_past_due`),
    0,
    `${paso}: un máximo menor que el día de entrada`,
  );
  assert.equal(
    await count(`SELECT count(*) AS n FROM credit_arrear_episodes e JOIN credits c ON c.id = e.credit_id
      WHERE e.ended_at IS NULL AND e.max_days_past_due < c.days_past_due`),
    0,
    `${paso}: el máximo de un episodio abierto quedó por debajo de los días de hoy`,
  );
}

describe('Episodios de mora — por las vías reales', { timeout: 600_000 }, () => {
  before(async () => {
    await freshDatabase();
    prisma = db();
    const collector = await prisma.user.findUniqueOrThrow({ where: { email: 'collector@kobrax.demo' }, include: { userAccounts: true } });
    accountId = collector.userAccounts[0]!.accountId;
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.account.update({
      where: { id: accountId },
      data: { configuration: { ...((account.configuration as object) ?? {}), importConfig } },
    });
    await prisma.externalAdvisorLink.upsert({
      where: { accountId_externalSource_advisorCode: { accountId, externalSource: 'PSF', advisorCode: 'CQE' } },
      update: { userId: collector.id, deletedAt: null },
      create: { accountId, externalSource: 'PSF', advisorCode: 'CQE', userId: collector.id },
    });
    await startApi();
    token = await login('collector@kobrax.demo');
  });

  after(async () => {
    stopApi();
    await prisma?.$disconnect();
  });

  it('la migración corrió de cero y el backfill dejó el historial consistente con el seed', async () => {
    assert.ok(await count(`SELECT count(*) AS n FROM credit_arrear_episodes`) > 0, 'el seed trae créditos en mora');
    await assertInvariantes('seed');
  });

  for (const [i, report] of REPORTS.entries()) {
    it(`importar el reporte ${i + 1} (${report.slice(14, 22)}): el historial sigue a la mora`, async () => {
      const res = await importReport<PortfolioSummary>(token, report);
      assert.equal(res.status, 201, JSON.stringify(res.error));
      await assertInvariantes(report);
    });
  }

  it('los episodios importados dicen de dónde salen: IMPORTED, con inicio estimado desde el corte', async () => {
    const rows = await prisma.$queryRawUnsafe<
      { source: string; started_at_estimated: boolean; started_at: Date; reported_as_of: Date | null; start_days_past_due: number }[]
    >(`SELECT e.source, e.started_at_estimated, e.started_at, c.reported_as_of, e.start_days_past_due
       FROM credit_arrear_episodes e JOIN credits c ON c.id = e.credit_id
       WHERE c.external_source = 'PSF' AND NOT e.reconstructed`);
    assert.ok(rows.length > 0, 'hay episodios de PSF');
    assert.ok(rows.every((r) => r.source === 'IMPORTED' && r.started_at_estimated), 'importados y estimados: el archivo sólo trae días');
    // Ninguno empieza en el futuro de su propio corte.
    assert.ok(rows.every((r) => !r.reported_as_of || r.started_at <= r.reported_as_of));
  });

  it('una operación ausente del reporte no cuenta como recuperada: SOURCE_ABSENT, nunca PAID/CURRENT', async () => {
    const ausentes = await prisma.$queryRawUnsafe<{ id: string; sync_status: string }[]>(
      `SELECT c.id, c.sync_status::text AS sync_status FROM credits c WHERE c.external_source = 'PSF' AND c.sync_status::text = 'ABSENT'`,
    );
    for (const a of ausentes) {
      const abiertos = await count(`SELECT count(*) AS n FROM credit_arrear_episodes WHERE credit_id = '${a.id}' AND ended_at IS NULL`);
      const mal = await count(
        `SELECT count(*) AS n FROM credit_arrear_episodes WHERE credit_id = '${a.id}' AND end_reason IN ('PAID', 'CURRENT') AND NOT reconstructed`,
      );
      assert.equal(mal, 0, `la ausente ${a.id} no puede figurar como recuperada`);
      // Ausente con mora que el reporte no tocó puede seguir abierta; lo que no puede es mentir al cerrarse.
      assert.ok(abiertos <= 1);
    }
  });

  it('una acción manual de la API (marcar y poner al día) abre y cierra el episodio', async () => {
    const credit = await prisma.credit.findFirstOrThrow({
      where: { accountId, externalSource: null, daysPastDue: 0, status: 'ACTIVE', deletedAt: null },
    });
    const marca = await call(token, 'POST', `/credits/${credit.id}/arrears`, { days: 12 });
    assert.ok(marca.status === 200 || marca.status === 201, JSON.stringify(marca.error));
    let eps = await prisma.creditArrearEpisode.findMany({ where: { creditId: credit.id } });
    assert.equal(eps.length, 1);
    assert.equal(eps[0]!.source, 'MANUAL');
    assert.equal(eps[0]!.startedAtEstimated, false, 'alguien declaró desde cuándo: no es estimado');
    assert.equal(eps[0]!.endedAt, null);
    await assertInvariantes('marcar');

    const alDia = await call(token, 'POST', `/credits/${credit.id}/arrears/clear`, { mode: 'next_period' });
    assert.ok(alDia.status === 200 || alDia.status === 201, JSON.stringify(alDia.error));
    eps = await prisma.creditArrearEpisode.findMany({ where: { creditId: credit.id } });
    assert.equal(eps.length, 1);
    assert.equal(eps[0]!.endReason, 'CURRENT');
    assert.ok(eps[0]!.endedAt);
    await assertInvariantes('poner al día');
  });
});
