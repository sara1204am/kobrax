/**
 * Backfill de catálogos por defecto (F4/13 · D-01).
 *
 * Las cuentas registradas antes de que el registro sembrara catálogos no tienen métodos de pago, bancos, motivos de
 * no pago ni rubros. Este script les agrega los que falten.
 *
 *   pnpm --filter @kobrax/database db:backfill:catalogs            # aplica
 *   pnpm --filter @kobrax/database db:backfill:catalogs -- --dry   # solo cuenta, no escribe
 *
 * Es **idempotente y no destructivo**: `skipDuplicates` sobre (cuenta, catálogo, código) no pisa lo que alguien
 * editó ni vuelve a crear lo que una cuenta dio de baja (la fila borrada lógicamente sigue ocupando la clave).
 *
 * Corre con `DATABASE_URL` (propietario de la base, que no pasa por RLS): escribe para todas las cuentas.
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { catalogDefaultRows } from '@kobrax/shared';

const prisma = new PrismaClient();
const DRY = process.argv.includes('--dry');

async function main(): Promise<void> {
  const accounts = await prisma.account.findMany({ where: { deletedAt: null }, select: { id: true, code: true, businessName: true } });
  let total = 0;
  for (const account of accounts) {
    const rows = catalogDefaultRows(account.id).map((r) => ({ ...r, metadata: r.metadata as Prisma.InputJsonValue }));
    if (DRY) {
      const existing = await prisma.catalogItem.findMany({ where: { accountId: account.id }, select: { catalog: true, code: true } });
      const have = new Set(existing.map((e) => `${e.catalog}:${e.code}`));
      const missing = rows.filter((r) => !have.has(`${r.catalog}:${r.code}`)).length;
      total += missing;
      console.log(`  · ${account.code ?? account.id} (${account.businessName}): faltan ${missing}`);
      continue;
    }
    const res = await prisma.catalogItem.createMany({ data: rows, skipDuplicates: true });
    total += res.count;
    console.log(`  ✓ ${account.code ?? account.id} (${account.businessName}): ${res.count} agregados`);
  }
  console.log(`${DRY ? 'Faltarían' : 'Agregados'} ${total} catálogos en ${accounts.length} cuentas${DRY ? ' (simulacro: no se escribió nada)' : ''}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
