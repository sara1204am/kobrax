/**
 * Auditoría del responsable de los créditos — sólo lee.
 *
 *   pnpm --filter @kobrax/database db:audit:assignments
 *
 * El responsable vive en dos lugares que tienen que decir lo mismo: la fila permanente vigente de
 * `credit_assignments` (fuente de verdad del alcance `own`, y el historial) y su copia
 * `credits.assigned_manager_id`. Los escribe juntos `AssignmentService`; si algo los separó —un
 * UPDATE a mano, un camino nuevo que se olvidó del servicio— acá aparece. Sale con código 1 si hay
 * diferencias, para poder usarlo en un chequeo de despliegue.
 *
 * Recorre todas las cuentas con `DATABASE_URL` (superusuario en dev, sin RLS), como los seeds.
 * El arreglo, si hace falta, es volver a correr la migración `20261002000000_responsable_del_credito`
 * —es idempotente— o reasignar desde la ficha.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface Check {
  title: string;
  /** Sólo informa: no cuenta como diferencia ni hace fallar la salida. */
  informative?: boolean;
  rows: () => Promise<{ account_id: string; detail: string }[]>;
}

const PERMANENT = `ca.revoked_at IS NULL AND ca.expires_at IS NULL AND ca.case_id IS NULL`;

const CHECKS: Check[] = [
  {
    title: 'Crédito con responsable y sin asignación permanente vigente',
    rows: () =>
      prisma.$queryRawUnsafe(`
        SELECT c.account_id, COALESCE(c.code, c.id) AS detail FROM credits c
        WHERE c.deleted_at IS NULL AND c.assigned_manager_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM credit_assignments ca WHERE ca.credit_id = c.id AND ${PERMANENT})`),
  },
  {
    title: 'Asignación permanente vigente que no coincide con el responsable del crédito',
    rows: () =>
      prisma.$queryRawUnsafe(`
        SELECT c.account_id, COALESCE(c.code, c.id) || ' · tabla ' || ca.user_id || ' / columna ' || COALESCE(c.assigned_manager_id, '—') AS detail
        FROM credit_assignments ca JOIN credits c ON c.id = ca.credit_id
        WHERE ${PERMANENT} AND (c.assigned_manager_id IS DISTINCT FROM ca.user_id OR c.deleted_at IS NOT NULL)`),
  },
  {
    title: 'Responsable que ya no es miembro activo de la cuenta',
    informative: true,
    rows: () =>
      prisma.$queryRawUnsafe(`
        SELECT c.account_id, COALESCE(c.code, c.id) || ' · ' || c.assigned_manager_id AS detail FROM credits c
        WHERE c.deleted_at IS NULL AND c.assigned_manager_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM user_accounts ua
                          WHERE ua.user_id = c.assigned_manager_id AND ua.account_id = c.account_id AND ua.is_active)`),
  },
];

async function main(): Promise<void> {
  console.log(`Auditoría de responsables — ${new Date().toISOString().slice(0, 10)} (sólo lectura)\n`);
  let total = 0;
  for (const check of CHECKS) {
    const rows = await check.rows();
    if (!check.informative) total += rows.length;
    console.log(`${rows.length === 0 ? 'OK ' : '!! '}${check.title}: ${rows.length}`);
    for (const r of rows.slice(0, 20)) console.log(`       · [${r.account_id.slice(0, 8)}] ${r.detail}`);
    if (rows.length > 20) console.log(`       · … y ${rows.length - 20} más`);
  }
  console.log(`\n${total} diferencias.`);
  // El de miembros inactivos informa pero no falla: un cobrador dado de baja con cartera es trabajo
  // de reasignación pendiente, no una inconsistencia de datos.
  if (total > 0) process.exitCode = 1;
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
