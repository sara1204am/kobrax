/**
 * F14 · F2b — costo de la barrera medido en la BASE (D-4), sin el ruido de la API.
 *
 * Complementa a `f2b-rendimiento.perf.ts`: a escala la API ya es lenta sin la barrera (varios segundos por listado y 500 por el tope de
 * 5 s de la transacción de Prisma), y el orden de las fases (primero `off`, después `enforce`) mezcla el costo de la barrera con el de la
 * caché fría. Acá se usan consultas del tipo de las que emite la API, como `kobrax_app`, y se ALTERNA `off` / `enforce` en cada
 * repetición: el ruido de la máquina cae en los dos lados por igual.
 *
 * Requiere los datos que deja `f2b-rendimiento.perf.ts` en `kobrax_it` (no recrea la base):
 *
 *   node --import tsx test/integration/f2b-rendimiento-sql.perf.ts
 */
import { performance } from 'node:perf_hooks';
import { appDb, db } from './harness';

const BUDGET = 1.2;
const REPS = Number(process.env.PERF_REPS ?? 15);
const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!;
const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

interface Q {
  name: string;
  scope: 'own' | 'branch' | 'subtree' | 'account';
  user: 'colMV' | 'supMV' | 'mgrChq' | 'admin';
  sql: string;
  /** false = consulta que OLVIDA el filtro: la barrera la acota a propósito, el cambio de tiempo no es una regresión (sólo informativa). */
  gated: boolean;
}

async function main(): Promise<void> {
  const su = db();
  const app = appDb();
  const acc = (await su.$queryRawUnsafe<{ account_id: string }[]>(`SELECT account_id FROM credits GROUP BY 1 ORDER BY count(*) DESC LIMIT 1`))[0]!.account_id;
  const user = async (prefix: string): Promise<string> =>
    (await su.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM users WHERE email LIKE '${prefix}-%' ORDER BY created_at DESC LIMIT 1`))[0]!.id;
  const uid = { colMV: await user('colmv'), supMV: await user('supmv'), mgrChq: await user('mgrchq'), admin: await user('perf') };
  const offices = await su.$queryRawUnsafe<{ id: string; code: string | null }[]>(`SELECT id, code FROM branches WHERE account_id='${acc}'`);
  const mv = offices.find((o) => o.code === 'MV')!.id;
  const pad = offices.find((o) => o.code === 'PAD')!.id;
  const n = (await su.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) n FROM credits WHERE account_id='${acc}'`))[0]!.n;
  console.log(`Cuenta ${acc}: ${n} créditos`);

  const U = uid.colMV;
  const qs: Q[] = [
    { name: 'cobrador · lista de créditos', scope: 'own', user: 'colMV', gated: true, sql: `SELECT id FROM credits WHERE deleted_at IS NULL AND assigned_manager_id='${U}' ORDER BY days_past_due DESC LIMIT 50` },
    { name: 'cobrador · conteo de créditos', scope: 'own', user: 'colMV', gated: true, sql: `SELECT count(*) FROM credits WHERE deleted_at IS NULL AND assigned_manager_id='${U}'` },
    { name: 'cobrador · pagos de lo suyo', scope: 'own', user: 'colMV', gated: true, sql: `SELECT p.id FROM payments p JOIN credits c ON c.id=p.credit_id WHERE c.assigned_manager_id='${U}' ORDER BY p.payment_date DESC LIMIT 50` },
    { name: 'cobrador · clientes de lo suyo', scope: 'own', user: 'colMV', gated: true, sql: `SELECT id FROM clients WHERE id IN (SELECT client_id FROM credits WHERE assigned_manager_id='${U}') ORDER BY created_at DESC LIMIT 50` },
    { name: 'cobrador · agenda propia', scope: 'own', user: 'colMV', gated: true, sql: `SELECT id FROM agenda_items WHERE assignee_id='${U}' ORDER BY scheduled_date DESC LIMIT 50` },
    { name: 'supervisor · lista de su oficina', scope: 'branch', user: 'supMV', gated: true, sql: `SELECT id FROM credits WHERE deleted_at IS NULL AND branch_id='${mv}' ORDER BY days_past_due DESC LIMIT 50` },
    { name: 'supervisor · pagos de su oficina', scope: 'branch', user: 'supMV', gated: true, sql: `SELECT p.id FROM payments p JOIN credits c ON c.id=p.credit_id WHERE c.branch_id='${mv}' ORDER BY p.payment_date DESC LIMIT 50` },
    { name: 'supervisor · clientes de su oficina', scope: 'branch', user: 'supMV', gated: true, sql: `SELECT id FROM clients WHERE registered_branch_id='${mv}' ORDER BY created_at DESC LIMIT 50` },
    { name: 'gerente regional · lista del subárbol', scope: 'subtree', user: 'mgrChq', gated: true, sql: `SELECT id FROM credits WHERE deleted_at IS NULL AND branch_id IN ('${mv}','${pad}') ORDER BY days_past_due DESC LIMIT 50` },
    { name: 'gerente regional · conteo del subárbol', scope: 'subtree', user: 'mgrChq', gated: true, sql: `SELECT count(*) FROM credits WHERE deleted_at IS NULL AND branch_id IN ('${mv}','${pad}')` },
    { name: 'administrador · lista de créditos', scope: 'account', user: 'admin', gated: true, sql: `SELECT id FROM credits WHERE deleted_at IS NULL ORDER BY days_past_due DESC LIMIT 50` },
    { name: 'administrador · conteo de créditos', scope: 'account', user: 'admin', gated: true, sql: `SELECT count(*) FROM credits WHERE deleted_at IS NULL` },
    { name: 'administrador · pagos', scope: 'account', user: 'admin', gated: true, sql: `SELECT id FROM payments ORDER BY payment_date DESC LIMIT 50` },
    { name: 'administrador · clientes', scope: 'account', user: 'admin', gated: true, sql: `SELECT id FROM clients ORDER BY created_at DESC LIMIT 50` },
    { name: '(informativa) cobrador olvida el filtro: SELECT count(*) credits', scope: 'own', user: 'colMV', gated: false, sql: `SELECT count(*) FROM credits` },
    { name: '(informativa) cobrador olvida el filtro: SELECT count(*) clients', scope: 'own', user: 'colMV', gated: false, sql: `SELECT count(*) FROM clients` },
  ];

  const run = async (q: Q, mode: 'off' | 'enforce'): Promise<number> => {
    const s = performance.now();
    await app.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT set_config('app.current_account_id', '${acc}', true), set_config('app.current_user_id', '${uid[q.user]}', true), set_config('app.scope', '${q.scope}', true), set_config('app.scope_mode', '${mode}', true)`,
        );
        await tx.$queryRawUnsafe(q.sql);
      },
      { timeout: 60_000 },
    );
    return performance.now() - s;
  };

  let worst = 0;
  console.log('\nconsulta'.padEnd(66) + 'p95 off'.padStart(10) + 'p95 enf'.padStart(10) + '  p95×'.padStart(8) + 'med off'.padStart(10) + 'med enf'.padStart(10) + '  med×'.padStart(8));
  for (const q of qs) {
    await run(q, 'off'); // calentamiento de caché, una vez por consulta
    await run(q, 'enforce');
    const off: number[] = [];
    const enf: number[] = [];
    for (let i = 0; i < REPS; i++) {
      // Se alterna quién va primero para que ninguno herede siempre la caché del otro.
      if (i % 2 === 0) {
        off.push(await run(q, 'off'));
        enf.push(await run(q, 'enforce'));
      } else {
        enf.push(await run(q, 'enforce'));
        off.push(await run(q, 'off'));
      }
    }
    const r95 = p95(enf) / p95(off);
    const rMed = median(enf) / median(off);
    if (q.gated) worst = Math.max(worst, r95);
    console.log(
      q.name.padEnd(66) + p95(off).toFixed(1).padStart(10) + p95(enf).toFixed(1).padStart(10) + `  x${r95.toFixed(2)}`.padStart(8) +
        median(off).toFixed(1).padStart(10) + median(enf).toFixed(1).padStart(10) + `  x${rMed.toFixed(2)}`.padStart(8) + (q.gated && r95 > BUDGET ? '  ⛔' : ''),
    );
  }
  console.log(`\nPeor p95 (consultas con filtro): x${worst.toFixed(2)} — presupuesto D-4: x${BUDGET.toFixed(2)}`);
  await su.$disconnect();
  await app.$disconnect();
  process.exit(worst > BUDGET ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
