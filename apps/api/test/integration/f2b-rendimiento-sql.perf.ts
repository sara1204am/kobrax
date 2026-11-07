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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { appDb, db } from './harness';

const BUDGET = 1.2;
/** Por debajo de esto, un cambio relativo grande en una consulta de pocos ms es ruido de medición, no un costo. */
const ABS_NOISE_MS = 5;
const REPS = Number(process.env.PERF_REPS ?? 25);
const min = (xs: number[]): number => Math.min(...xs);
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

  // Tres estados de la base: `none` = SIN las policies de F2b (el sistema de hoy: la línea base de D-4); `off` = instaladas pero apagadas;
  // `enforce` = instaladas y activas. Cambiar de estado = (re)aplicar el 006 o borrar las policies, así que se mide contra el mismo dato.
  type State = 'none' | 'off' | 'enforce';
  const psql = (sql: string): void => {
    execFileSync('docker', ['exec', '-i', 'kobrax-postgres', 'psql', '-U', 'postgres', '-d', 'kobrax_it', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
  };
  const install = readFileSync(join(__dirname, '../../../../packages/database/prisma/rls/006_scope_policies.sql'), 'utf8');
  const uninstall = ['credits', 'clients', 'payments', 'agenda_items', 'route_plans'].map((t) => `DROP POLICY IF EXISTS scope_${t} ON ${t};`).join('\n');
  let current: State | null = null;
  const setState = (st: State): void => {
    if (current === st) return;
    // off ⇄ enforce no cambia la base (sólo la variable de la transacción); lo demás sí.
    if (!(current && current !== 'none' && st !== 'none')) psql(st === 'none' ? uninstall : install);
    current = st;
  };

  const run = async (q: Q, st: State): Promise<number> => {
    const s = performance.now();
    await app.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          `SELECT set_config('app.current_account_id', '${acc}', true), set_config('app.current_user_id', '${uid[q.user]}', true), set_config('app.scope', '${q.scope}', true), set_config('app.scope_mode', '${st === 'none' ? 'off' : st}', true)`,
        );
        if (st !== 'none' && st !== 'off' && q.scope !== 'account') await tx.$executeRawUnsafe(`SET LOCAL ROLE kobrax_scoped`); // como PrismaService.runScoped
        await tx.$queryRawUnsafe(q.sql);
      },
      { timeout: 60_000 },
    );
    return performance.now() - s;
  };

  const ROUND = 5; // repeticiones por estado y por ronda; REPS/ROUND rondas, rotando el orden de los estados
  let worst = 0;
  let worstMed = 0;
  let worstAbs = 0;
  let failing = 0;
  console.log(
    '\nconsulta'.padEnd(60) + 'p95 none'.padStart(10) + 'p95 off'.padStart(10) + 'p95 enf'.padStart(10) + ' enf/none'.padStart(10) + 'med none'.padStart(10) + 'med enf'.padStart(10) + ' enf/none'.padStart(10) +
      ' off/none'.padStart(10) + '  +ms med',
  );
  for (const q of qs) {
    const samples: Record<State, number[]> = { none: [], off: [], enforce: [] };
    const orders: State[][] = [['none', 'off', 'enforce'], ['enforce', 'off', 'none'], ['off', 'none', 'enforce'], ['enforce', 'none', 'off']];
    for (let r = 0; r < Math.ceil(REPS / ROUND); r++) {
      for (const st of orders[r % orders.length]!) {
        setState(st);
        if (r === 0) await run(q, st); // calentamiento de caché y de plan
        for (let i = 0; i < ROUND; i++) samples[st].push(await run(q, st));
      }
    }
    const r95 = p95(samples.enforce) / p95(samples.none);
    const rMed = median(samples.enforce) / median(samples.none);
    const rOff = median(samples.off) / median(samples.none);
    const addMs = median(samples.enforce) - median(samples.none);
    const over = q.gated && rMed > BUDGET && addMs > ABS_NOISE_MS;
    if (q.gated) {
      worst = Math.max(worst, r95);
      worstMed = Math.max(worstMed, rMed);
      worstAbs = Math.max(worstAbs, addMs);
      if (over) failing++;
    }
    console.log(
      q.name.padEnd(60) + p95(samples.none).toFixed(1).padStart(10) + p95(samples.off).toFixed(1).padStart(10) + p95(samples.enforce).toFixed(1).padStart(10) + `  x${r95.toFixed(2)}`.padStart(10) +
        median(samples.none).toFixed(1).padStart(10) + median(samples.enforce).toFixed(1).padStart(10) + `  x${rMed.toFixed(2)}`.padStart(10) + `  x${rOff.toFixed(2)}`.padStart(10) + `${addMs.toFixed(1)}`.padStart(10) + (over ? '  ⛔' : ''),
    );
  }
  setState('off'); // la base queda con las policies instaladas (como en el entorno de desarrollo)
  console.log(`\nPeor p95 enforce/none: x${worst.toFixed(2)} · peor mediana: x${worstMed.toFixed(2)} (+${worstAbs.toFixed(1)} ms máx.) · consultas fuera de presupuesto: ${failing}`);
  console.log(`Presupuesto D-4: mediana enforce/none ≤ x${BUDGET.toFixed(2)}; ⛔ = lo supera Y agrega más de ${ABS_NOISE_MS} ms (por debajo es ruido de medición).`);
  await su.$disconnect();
  await app.$disconnect();
  process.exit(failing > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
