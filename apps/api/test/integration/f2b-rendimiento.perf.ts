/**
 * F14 · F2b — medición de rendimiento de la barrera (D-4): máximo +20 % en el p95 de los listados con ≥ 50 000 créditos.
 *
 * NO forma parte de `test:integration` (tarda y es una medición, no una afirmación). Se corre a pedido:
 *
 *   pnpm --filter @kobrax/api build && node --import tsx test/integration/f2b-rendimiento.perf.ts
 *
 * Carga 60 000 clientes y ~180 000 créditos (más ~90 000 pagos) en una cuenta con oficinas, y mide por HTTP —API real, rol real—
 * cada listado con la barrera en `off` y en `enforce`. Imprime una tabla y falla (exit 1) si algún p95 pasa del presupuesto.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { PrismaClient } from '@prisma/client';
import { addMember, API, call, db, freshDatabase, installScopePolicies, login, loginSkippingMfa, startApi, stopApi, uninstallScopePolicies } from './harness';

interface Office {
  id: string;
}
interface BranchType {
  id: string;
  code: string;
}

const BUDGET = 1.2;
const SAMPLES = Number(process.env.PERF_SAMPLES ?? 15);
const suffix = randomUUID().slice(0, 8);

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]!;

async function main(): Promise<void> {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', SCOPE_RLS_MODE: 'off' });
  const prisma: PrismaClient = db();

  const email = `perf-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: 'Banco Carga', firstName: 'Dueño', lastName: 'Carga', email, password: 'Kobrax123!' }),
  });
  if (res.status !== 201) throw new Error(await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  const accountId = owner.userAccounts[0]!.accountId;
  await prisma.account.update({ where: { id: accountId }, data: { planCode: 'ENTERPRISE', limitsOverride: { branches: 30, users: 60, credits: 1_000_000, clients: 1_000_000 } } });
  const admin = await loginSkippingMfa(email);

  const types = (await call<BranchType[]>(admin, 'GET', '/branch-types')).data!;
  const agencia = types.find((t) => t.code === 'AGENCIA')!.id;
  const regional = types.find((t) => t.code === 'REGIONAL')!.id;
  const root = ((await call<(Office & { isRoot: boolean })[]>(admin, 'GET', '/branches')).data ?? []).find((o) => o.isRoot)!;
  const mk = async (name: string, parentId: string, typeId: string, code?: string): Promise<Office> =>
    (await call<Office>(admin, 'POST', '/branches', { name, parentId, typeId, ...(code ? { code } : {}) })).data!;
  const chq = await mk('Chuquisaca', root.id, regional);
  const mv = await mk('Mesa Verde', chq.id, agencia, 'MV');
  const pad = await mk('Padilla', chq.id, agencia, 'PAD');
  const lpz = await mk('La Paz', root.id, regional);
  const alt = await mk('El Alto', lpz.id, agencia, 'ALT');
  const offices = [mv, pad, alt];

  const tok: Record<string, string> = { admin };
  const uid: Record<string, string> = {};
  const member = async (key: string, role: string, office: Office): Promise<void> => {
    const e = `${key.toLowerCase()}-${suffix}@ejemplo.com`;
    uid[key] = await addMember(prisma, accountId, e, key, role);
    await call(admin, 'POST', `/branches/${office.id}/members`, { userIds: [uid[key]] });
    tok[key] = await login(e);
  };
  await member('colMV', 'COLLECTOR', mv);
  await member('colPAD', 'COLLECTOR', pad);
  await member('colALT', 'COLLECTOR', alt);
  await member('supMV', 'SUPERVISOR', mv);
  await member('mgrChq', 'MANAGER', chq);

  // ── Carga masiva (triggers apagados: son 450 000 filas; los agregados del cliente no entran en lo que se mide) ───────────────
  const t0 = performance.now();
  const o = offices.map((x) => x.id);
  // PERF_COLLECTORS = cobradores POR OFICINA (por omisión 1: el peor caso, un solo cobrador con la tercera parte de la cartera = 60 000 créditos).
  // Con 50 (≈ 150 cobradores, ≈ 1 200 créditos cada uno) es la distribución realista de una cuenta de 180 000 créditos.
  const K = Number(process.env.PERF_COLLECTORS ?? 1);
  const pool: string[] = [];
  const firsts = [uid.colMV!, uid.colPAD!, uid.colALT!];
  const collectorRole = await prisma.role.findUniqueOrThrow({ where: { name: 'COLLECTOR' } });
  for (let g = 0; g < 3; g++) {
    pool.push(firsts[g]!);
    for (let j = 1; j < K; j++) {
      const u = await prisma.user.create({ data: { email: `extra-${g}-${j}-${suffix}@ejemplo.com`, passwordHash: 'x', status: 'ACTIVE', requiresPasswordChange: false } });
      await prisma.userAccount.create({ data: { userId: u.id, accountId, roleId: collectorRole.id } });
      pool.push(u.id);
    }
  }
  const poolSql = `(ARRAY[${pool.map((x) => `'${x}'`).join(',')}])`;
  const pick = `${poolSql}[1 + (i % 3) * ${K} + ((i / 3)::int % ${K})]`;
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(
        `INSERT INTO clients (id, account_id, first_name, last_name, client_type, client_status, risk_segment, registered_branch_id, created_at, updated_at)
         SELECT 'pc-' || i, '${accountId}', (ARRAY['Edgar','Maria','Juan','Rosa','Luis','Ana','Carlos','Elena'])[1 + (i % 8)],
                (ARRAY['Mamani','Quispe','Vargas','Choque','Flores','Rojas'])[1 + (i % 6)] || ' ' || i, 'PERSON',
                (ARRAY['ACTIVE','ACTIVE','ACTIVE','INACTIVE'])[1 + (i % 4)]::"ClientStatus", (ARRAY['LOW','MEDIUM','HIGH'])[1 + (i % 3)],
                (ARRAY['${o[0]}','${o[1]}','${o[2]}'])[1 + (i % 3)], now() - (i || ' minutes')::interval, now()
         FROM generate_series(1, 60000) i`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO credits (id, account_id, client_id, branch_id, assigned_manager_id, principal_amount, outstanding_balance, currency, installments_count, status, days_past_due, created_at, updated_at)
         SELECT 'pk-' || i || '-' || n, '${accountId}', 'pc-' || i, (ARRAY['${o[0]}','${o[1]}','${o[2]}'])[1 + (i % 3)],
                ${pick}, 1000 + (i % 40) * 500, 100 + ((i * 7 + n) % 900) * 50, 'BOB', 12,
                'ACTIVE'::"CreditStatus", CASE WHEN (i + n) % 3 = 0 THEN 0 ELSE (i * 13 + n * 7) % 460 END, now(), now()
         FROM generate_series(1, 60000) i, LATERAL generate_series(1, 1 + (i % 5)) n`,
      );
      await tx.$executeRawUnsafe(
        `INSERT INTO payments (id, account_id, credit_id, branch_id, amount, method, payment_date, created_at)
         SELECT 'pp-' || i, '${accountId}', 'pk-' || i || '-1', (ARRAY['${o[0]}','${o[1]}','${o[2]}'])[1 + (i % 3)], 50 + (i % 20) * 10, 'CASH', now() - (i || ' minutes')::interval, now()
         FROM generate_series(1, 90000) i`,
      );
    },
    { timeout: 600_000, maxWait: 60_000 },
  );
  // La carga apaga los triggers (session_replication_role = replica): las copias de F2b se rellenan acá, igual que el backfill de la migración.
  await prisma.$executeRawUnsafe(`UPDATE payments p SET credit_branch_id = c.branch_id, credit_manager_id = c.assigned_manager_id FROM credits c WHERE c.id = p.credit_id`);
  await prisma.$executeRawUnsafe(
    `UPDATE clients cl SET scope_manager_ids = s.m, scope_branch_ids = s.b
     FROM (SELECT client_id, COALESCE(array_agg(DISTINCT assigned_manager_id) FILTER (WHERE assigned_manager_id IS NOT NULL), '{}') m,
                  COALESCE(array_agg(DISTINCT branch_id) FILTER (WHERE branch_id IS NOT NULL), '{}') b FROM credits WHERE deleted_at IS NULL GROUP BY client_id) s
     WHERE cl.id = s.client_id`,
  );
  await prisma.$executeRawUnsafe(`UPDATE clients cl SET credit_count = s.n FROM (SELECT client_id, count(*)::int n FROM credits WHERE deleted_at IS NULL GROUP BY client_id) s WHERE cl.id = s.client_id`);
  await prisma.$executeRawUnsafe('ANALYZE clients');
  await prisma.$executeRawUnsafe('ANALYZE credits');
  await prisma.$executeRawUnsafe('ANALYZE payments');
  await prisma.$executeRawUnsafe('VACUUM (ANALYZE) credits');
  const n = await prisma.credit.count({ where: { accountId } });
  console.log(`Carga lista en ${Math.round((performance.now() - t0) / 1000)} s: ${n} créditos`);

  if (process.env.PERF_LOAD_ONLY) {
    // Sólo deja los datos en `kobrax_it` para `f2b-rendimiento-sql.perf.ts` (no mide por HTTP).
    stopApi();
    await prisma.$disconnect();
    process.exit(0);
  }

  const roles = ['colMV', 'supMV', 'mgrChq', 'admin'];
  const lists = ['/credits?limit=50', '/credits?limit=50&page=200', '/clients?limit=50', '/payments?limit=50'];
  const failures: Record<string, number> = {};
  const measure = async (): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    for (const role of roles) {
      // El JWT dura 15 min y la medición más: se entra de nuevo antes de cada rol.
      tok[role] = role === 'admin' ? await loginSkippingMfa(email) : await login(`${role.toLowerCase()}-${suffix}@ejemplo.com`);
      for (const path of lists) {
        for (let i = 0; i < 3; i++) await call(tok[role]!, 'GET', path); // calentamiento
        // Sólo cuentan las respuestas 200: algunos listados YA son lentos sin la barrera (> 5 s de la transacción de Prisma → 500) y
        // mezclar errores con tiempos falsearía la comparación. Los fallos se informan aparte.
        const xs: number[] = [];
        let failed = 0;
        for (let i = 0; i < SAMPLES; i++) {
          const s = performance.now();
          const r = await call(tok[role]!, 'GET', path);
          const ms = performance.now() - s;
          if (r.status === 200) xs.push(ms);
          else failed++;
        }
        out[`${role} ${path}`] = xs.length > 0 ? p95(xs) : Number.NaN;
        if (failed > 0) failures[`${role} ${path}`] = (failures[`${role} ${path}`] ?? 0) + failed;
      }
    }
    return out;
  };

  // Línea base de D-4: el sistema SIN las policies de F2b (como estaba antes de esta fase). Después se instalan y se mide con `enforce`.
  uninstallScopePolicies();
  console.log('Línea base: policies de F2b NO instaladas');
  const off = await measure();
  installScopePolicies();
  console.log('Policies de F2b instaladas; API en enforce');
  // Mismo conjunto de datos, la API reiniciada con la barrera activa.
  stopApi();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01', SCOPE_RLS_MODE: 'enforce' });
  // Las sesiones siguen válidas (misma base y misma clave); si no, se vuelve a entrar.
  for (const k of Object.keys(uid)) tok[k] = await login(`${k.toLowerCase()}-${suffix}@ejemplo.com`);
  tok.admin = await loginSkippingMfa(email);
  const enf = await measure();

  let worst = 0;
  console.log('\nrol y listado'.padEnd(36) + 'p95 sin F2b (ms)'.padStart(14) + 'p95 enforce'.padStart(14) + '  ratio');
  for (const key of Object.keys(off)) {
    const ratio = enf[key]! / off[key]!;
    if (!Number.isNaN(ratio)) worst = Math.max(worst, ratio);
    const f = failures[key] ? `  (${failures[key]} respuestas no-200 descartadas)` : '';
    console.log(key.padEnd(36) + off[key]!.toFixed(1).padStart(14) + enf[key]!.toFixed(1).padStart(14) + `  x${ratio.toFixed(2)}${ratio > BUDGET ? '  ⛔' : ''}${f}`);
  }
  console.log(`\nPeor ratio enforce/sin-F2b: x${worst.toFixed(2)} (presupuesto D-4: x${BUDGET.toFixed(2)})`);
  stopApi();
  await prisma.$disconnect();
  process.exit(worst > BUDGET ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  stopApi();
  process.exit(2);
});
