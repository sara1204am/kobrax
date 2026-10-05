/**
 * Recrea una base DESDE CERO: esquema vacío → migraciones → RLS → seed.
 *
 *   pnpm db:rebuild --force            (usa DATABASE_URL del entorno / .env)
 *   pnpm db:rebuild --force --no-seed
 *
 * Por qué existe: `prisma migrate reset` NO alcanza en este repo. Tres migraciones antiguas crean policies con
 * `app_current_account()`, que define `rls/001_enable_rls.sql`, y ese script no puede correr antes de que existan las
 * tablas; sobre una base vacía `migrate reset` se cae en `20260618160000_add_client_import_runs` (P3018). Este script
 * hace lo mismo que `apps/api/test/integration/harness.ts#freshDatabase`: crea el helper solo, aplica las migraciones,
 * corre los scripts de `prisma/rls/` (que lo recrean con CASCADE y vuelven a poner las policies) y siembra.
 *
 * 🔴 DESTRUCTIVO: borra el esquema `public` de la base de DATABASE_URL. Por eso exige `--force`.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const ROOT = join(__dirname, '..');
const RLS_DIR = join(__dirname, 'rls');

function run(args: string[], label: string): void {
  console.log(`  → ${label}`);
  const r = spawnSync('pnpm', ['exec', ...args], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32', env: process.env });
  if (r.status !== 0) throw new Error(`falló: ${label}`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Falta DATABASE_URL');
  const dbName = new URL(url).pathname.slice(1);
  if (!process.argv.includes('--force')) {
    console.error(`Esto BORRA el esquema public de la base «${dbName}» y la recrea. Repetí con --force para confirmar.`);
    process.exit(1);
  }
  console.log(`♻️  Recreando «${dbName}»...`);

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await prisma.$executeRawUnsafe('CREATE SCHEMA public');
    // 🔴 Al borrar `public` se pierden los permisos que da infra/postgres/init/01-create-app-role.sql (solo corre al
    // crear el volumen): sin ellos la API (rol kobrax_app, sujeto a RLS) falla con «permission denied for schema public».
    // Van ANTES de las migraciones para que los privilegios por defecto alcancen a las tablas que se crean después.
    await prisma.$executeRawUnsafe(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kobrax_app') THEN
        GRANT USAGE ON SCHEMA public TO kobrax_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kobrax_app;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kobrax_app;
      END IF;
    END $$`);
    // El helper que las migraciones viejas necesitan antes de que exista 001 (lo recrea 001 con CASCADE).
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION app_current_account() RETURNS text AS $$ SELECT NULLIF(current_setting('app.current_account_id', true), ''); $$ LANGUAGE sql STABLE`,
    );
  } finally {
    await prisma.$disconnect();
  }

  run(['prisma', 'migrate', 'deploy'], 'migraciones');
  const rls = readdirSync(RLS_DIR)
    .filter((f) => f.endsWith('.sql') && !f.startsWith('verify'))
    .sort();
  for (const f of rls) run(['prisma', 'db', 'execute', '--file', join(RLS_DIR, f), '--schema', join(__dirname, 'schema.prisma')], `RLS · ${f}`);
  if (!process.argv.includes('--no-seed')) run(['tsx', 'prisma/seed.ts'], 'seed');
  console.log('✅ Base recreada.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
