/**
 * Auditoría de la cartera de fuente externa (PSF) — fase 9 del análisis de brecha.
 *
 *   pnpm --filter @kobrax/database db:audit:psf            → sólo lee e informa
 *   pnpm --filter @kobrax/database db:audit:psf --apply    → además aplica los arreglos seguros
 *
 * Busca lo que dejaron las reglas viejas —las de antes de las fases 1 a 8— y lo que ninguna regla
 * puede arreglar sola (duplicados, datos sin historia). Recorre **todas las cuentas**: conecta con
 * `DATABASE_URL`, que en dev es superusuario y no pasa por RLS, igual que los seeds.
 *
 * 🔴 **Sin `--apply` no escribe nada.** Y con `--apply` sólo toca lo mecánico, donde la respuesta
 * correcta no depende de nadie:
 *
 *   A. Episodio de mora de una operación AUSENTE cerrado como «al día» (\`CURRENT\`) → el motivo pasa a
 *      \`SOURCE_ABSENT\`. La ausencia no es ponerse al día (D4).
 *   B. Episodio ABIERTO de una operación AUSENTE → se cierra con \`SOURCE_ABSENT\`, lo mismo que haría el
 *      trigger de episodios.
 *
 * Lo demás **se informa y no se toca**: fusionar clientes, dar por cerrado un crédito o inventarle
 * una fecha de corte son decisiones de una persona (D2, D4, D9).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface Check {
  code: string;
  title: string;
  /** Qué hacer con lo que encuentre. */
  action: string;
  /** Filas: cuenta + una descripción corta de cada hallazgo. */
  rows: () => Promise<{ account_id: string; detail: string }[]>;
}

const CHECKS: Check[] = [
  {
    code: 'IMPORT_WITHOUT_SOURCE',
    title: 'Importados sin fuente externa',
    action: 'Asignar external_source/external_id a mano: sin identidad, el próximo reporte los duplica (D1).',
    rows: () => prisma.$queryRaw`
      SELECT account_id, COALESCE(code, id) AS detail FROM credits
      WHERE origin = 'IMPORT' AND external_source IS NULL AND deleted_at IS NULL`,
  },
  {
    code: 'EXTERNAL_WITHOUT_HISTORY',
    title: 'Externos sin ningún snapshot (importados antes de que existiera el historial)',
    action: 'Se corrigen solos con el próximo reporte que los traiga. Hasta entonces la curva los suma planos y sin fecha de corte.',
    rows: () => prisma.$queryRaw`
      SELECT c.account_id, COALESCE(c.external_id, c.code, c.id) AS detail FROM credits c
      WHERE c.external_source IS NOT NULL AND c.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM credit_external_snapshots s WHERE s.credit_id = c.id)`,
  },
  {
    code: 'EXTERNAL_WITHOUT_ASOF',
    title: 'Externos sin fecha de corte',
    action: 'Mostrar «No registrado» es correcto (D9). Configurar la fecha de corte del formato para los reportes que vienen.',
    rows: () => prisma.$queryRaw`
      SELECT account_id, COALESCE(external_id, code, id) AS detail FROM credits
      WHERE external_source IS NOT NULL AND reported_as_of IS NULL AND deleted_at IS NULL`,
  },
  {
    code: 'EXTERNAL_WITH_INSTALLMENTS',
    title: 'Externos con cuotas',
    action: 'Un PSF no tiene cronograma: revisar de dónde salieron las cuotas antes de borrarlas.',
    rows: () => prisma.$queryRaw`
      SELECT c.account_id, COALESCE(c.external_id, c.code, c.id) AS detail FROM credits c
      WHERE c.external_source IS NOT NULL AND c.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM credit_installments i WHERE i.credit_id = c.id)`,
  },
  {
    code: 'EXTERNAL_CLOSED_UNCONFIRMED',
    title: 'Externos pagados o cancelados sin que el reporte lo diga',
    action: 'Antes de D3 un pago podía dejar un PSF en PAID. Confirmar con el banco y, si sigue vivo, volver a ACTIVE.',
    rows: () => prisma.$queryRaw`
      SELECT c.account_id, COALESCE(c.external_id, c.code, c.id) || ' (' || CASE WHEN c.written_off_at IS NOT NULL THEN 'WRITTEN_OFF' ELSE c.status::text END || ')' AS detail FROM credits c
      WHERE c.external_source IS NOT NULL AND c.deleted_at IS NULL
        AND (c.status IN ('PAID', 'CANCELLED') OR c.written_off_at IS NOT NULL)
        AND NOT EXISTS (
          SELECT 1 FROM credit_external_snapshots s
          WHERE s.credit_id = c.id AND upper(COALESCE(s.reported_status, '')) IN ('CANCELADO', 'CASTIGADO', 'PAGADO'))`,
  },
  {
    code: 'ABSENT_EPISODE_CLOSED_AS_CURRENT',
    title: '[A] Episodios de mora de operaciones ausentes cerrados como «al día»',
    action: 'Con --apply: el motivo pasa a SOURCE_ABSENT.',
    rows: () => prisma.$queryRaw`
      SELECT e.account_id, COALESCE(c.external_id, c.code, c.id) AS detail FROM credit_arrear_episodes e
      JOIN credits c ON c.id = e.credit_id
      WHERE c.sync_status = 'ABSENT' AND e.end_reason = 'CURRENT'`,
  },
  {
    code: 'ABSENT_EPISODE_OPEN',
    title: '[B] Episodios de mora abiertos de operaciones ausentes',
    action: 'Con --apply: se cierran con SOURCE_ABSENT (lo mismo que haría el trigger de episodios).',
    rows: () => prisma.$queryRaw`
      SELECT e.account_id, COALESCE(c.external_id, c.code, c.id) AS detail FROM credit_arrear_episodes e
      JOIN credits c ON c.id = e.credit_id
      WHERE c.sync_status = 'ABSENT' AND e.ended_at IS NULL`,
  },
  {
    code: 'DUPLICATE_CLIENT_NAME',
    title: 'Clientes con el mismo nombre (posibles duplicados)',
    action: 'Revisar y fusionar a mano (D2). La importación nueva ya no los crea: vincula o marca «Revisar vínculo».',
    rows: () => prisma.$queryRaw`
      SELECT account_id, nombre || ' ×' || n::text AS detail FROM (
        SELECT account_id,
               lower(regexp_replace(trim(COALESCE(business_name, concat_ws(' ', first_name, last_name))), '\s+', ' ', 'g')) AS nombre,
               COUNT(*) AS n
        FROM clients WHERE deleted_at IS NULL
        GROUP BY 1, 2 HAVING COUNT(*) > 1
      ) d`,
  },
  {
    code: 'LINK_REVIEW_PENDING',
    title: 'Clientes provisionales esperando «Revisar vínculo»',
    action: 'Resolver desde la ficha: vincular a un cliente existente o confirmar que es nuevo (D2).',
    rows: () => prisma.$queryRaw`
      SELECT account_id, concat_ws(' ', business_name, first_name, last_name) AS detail FROM clients
      WHERE link_review_pending AND deleted_at IS NULL`,
  },
  {
    code: 'CLIENT_TOTALS_DRIFT',
    title: 'Totales del cliente distintos de la suma de sus créditos',
    action: 'El trigger debería mantenerlos: si aparece algo, recalcular con SELECT portfolio_totals_recalc(id).',
    rows: () => prisma.$queryRaw`
      SELECT c.account_id, c.id AS detail FROM clients c
      WHERE c.deleted_at IS NULL
        AND c.total_debt <> COALESCE((SELECT SUM(k.outstanding_balance) FROM credits k WHERE k.client_id = c.id AND k.deleted_at IS NULL), 0)`,
  },
  {
    code: 'ORIGIN_METADATA_DRIFT',
    title: 'Origen de la columna distinto de metadata.origin',
    action: 'La columna manda (D1). Las apps viejas leen metadata: reescribirla desde la columna.',
    rows: () => prisma.$queryRaw`
      SELECT account_id, COALESCE(code, id) || ' (' || origin::text || ' / ' || COALESCE(metadata->>'origin', '—') || ')' AS detail
      FROM credits
      WHERE deleted_at IS NULL
        AND (origin = 'IMPORT') <> (COALESCE(metadata->>'origin', 'manual') = 'import')`,
  },
];

async function applyFixes(): Promise<void> {
  const relabeled = await prisma.$executeRaw`
    UPDATE credit_arrear_episodes e SET end_reason = 'SOURCE_ABSENT', updated_at = now()
    FROM credits c
    WHERE c.id = e.credit_id AND c.sync_status = 'ABSENT' AND e.end_reason = 'CURRENT'`;
  const closed = await prisma.$executeRaw`
    UPDATE credit_arrear_episodes e
    SET ended_at = GREATEST(CURRENT_DATE, e.started_at), end_reason = 'SOURCE_ABSENT',
        balance_at_end = c.outstanding_balance, updated_at = now()
    FROM credits c
    WHERE c.id = e.credit_id AND c.sync_status = 'ABSENT' AND e.ended_at IS NULL`;
  console.log(`
Aplicado: ${relabeled} episodios re-rotulados SOURCE_ABSENT [A], ${closed} episodios cerrados SOURCE_ABSENT [B].`);
}

async function main(): Promise<void> {
  console.log(`Auditoría PSF — ${new Date().toISOString().slice(0, 10)}${APPLY ? ' (con --apply)' : ' (sólo lectura)'}\n`);
  let total = 0;
  for (const check of CHECKS) {
    const rows = await check.rows();
    total += rows.length;
    const mark = rows.length === 0 ? 'OK ' : '!! ';
    console.log(`${mark}${check.title}: ${rows.length}`);
    if (rows.length === 0) continue;
    console.log(`     → ${check.action}`);
    for (const r of rows.slice(0, 20)) console.log(`       · [${r.account_id.slice(0, 8)}] ${r.detail}`);
    if (rows.length > 20) console.log(`       · … y ${rows.length - 20} más`);
  }
  console.log(`\n${total} hallazgos.`);
  if (APPLY) await applyFixes();
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
