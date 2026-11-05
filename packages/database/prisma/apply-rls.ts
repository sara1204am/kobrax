/**
 * Aplica TODOS los scripts de `prisma/rls/` en orden (idempotentes): `migrate deploy` no los corre y ahí viven las policies, los
 * grants y las funciones SECURITY DEFINER. Recorre la carpeta, así un script nuevo no se queda fuera. `verify_isolation.sql` es una
 * verificación, no se aplica.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

// El CLI se lanza con el mismo node (sin shell): evita problemas con rutas con espacios y con npx.cmd en Windows.
const prismaCli = require.resolve('prisma/build/index.js');
const dir = join(__dirname, 'rls');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql') && !f.startsWith('verify'))
  .sort();

for (const f of files) {
  const r = spawnSync(process.execPath, [prismaCli, 'db', 'execute', '--file', join(dir, f), '--schema', join(__dirname, 'schema.prisma')], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`✗ ${f}`);
    process.exit(r.status ?? 1);
  }
  console.log(`✓ ${f}`);
}
