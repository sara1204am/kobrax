/**
 * Corre TODAS las verificaciones de base de datos (`prisma/rls/verify_*.sql`) y falla si alguna falla (F14 · F9).
 *
 *   pnpm --filter @kobrax/database db:verify                       # base `kobrax`, contenedor `kobrax-postgres`
 *   pnpm --filter @kobrax/database db:verify -- --db kobrax_it     # otra base
 *   pnpm --filter @kobrax/database db:verify -- --container otro   # otro contenedor
 *   pnpm --filter @kobrax/database db:verify -- --local            # `psql` local con DATABASE_URL (sin docker)
 *   pnpm --filter @kobrax/database db:verify -- --only verify_scope.sql
 *
 * Todas SOLO LEEN: se pueden correr en producción. Cada una usa bloques `DO $$` y `\set ON_ERROR_STOP`, que un cliente de una sentencia por vez no
 * ejecuta, por eso va por `psql` (el del contenedor, o uno local). Sale con código 1 si alguna falla o si alguna no imprime ninguna comprobación.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseVerifyOutput, passed, verifyFiles } from './verify-lib';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const dir = join(__dirname, 'rls');
const db = arg('db') ?? 'kobrax';
const container = arg('container') ?? process.env.IT_PG_CONTAINER ?? 'kobrax-postgres';
const local = flag('local');
const only = arg('only');

const files = only ? [only] : verifyFiles(dir);
if (files.length === 0) {
  console.error('✗ no hay verificaciones en prisma/rls/');
  process.exit(1);
}

function psql(sql: string) {
  if (local) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('--local necesita DATABASE_URL');
    return spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
  }
  return spawnSync('docker', ['exec', '-i', container, 'sh', '-c', `psql -U "$POSTGRES_USER" -d ${db} -v ON_ERROR_STOP=1 -q`], { input: sql, encoding: 'utf8' });
}

let failed = 0;
console.log(`Verificaciones sobre «${db}» (${local ? 'psql local' : `contenedor ${container}`})\n`);
for (const f of files) {
  const r = psql(readFileSync(join(dir, f), 'utf8'));
  if (r.error) {
    console.error(`✗ ${f}: no se pudo ejecutar psql (${r.error.message})`);
    failed += 1;
    continue;
  }
  const report = parseVerifyOutput(r.stderr ?? '', r.stdout ?? '');
  if (passed(report, r.status)) {
    console.log(`✓ ${f}  (${report.ok.length} comprobaciones)`);
  } else {
    failed += 1;
    console.error(`✗ ${f}  (${report.ok.length} pasaron antes de fallar)`);
    console.error(`    CAUSA: ${report.error ?? (report.ok.length === 0 ? 'no imprimió ninguna comprobación' : `psql terminó con código ${r.status}`)}`);
  }
  for (const w of report.warnings) console.log(`    ${w}`);
}

console.log(failed === 0 ? `\n✓ ${files.length} verificaciones en verde` : `\n✗ ${failed} de ${files.length} verificaciones fallaron`);
process.exit(failed === 0 ? 0 : 1);
