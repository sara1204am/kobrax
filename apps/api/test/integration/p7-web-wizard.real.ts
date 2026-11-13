/**
 * F15 · P7 — verificación REAL del asistente de configuración: API compilada + Postgres/Redis reales + `next start` de la
 * web, con sesiones de verdad. NO es parte de `test:integration` (necesita `next build` y un segundo servidor): se corre a
 * mano y su salida va a `docs/epics/F15/execution/VERIFICATIONS.md`.
 *
 *   pnpm --filter @kobrax/api build && (cd apps/web && npx next build)
 *   cd apps/api && node --import tsx test/integration/p7-web-wizard.real.ts
 *
 * El asistente es un componente de cliente, pero Next lo renderiza también en el servidor: su marcado viaja en el HTML y es
 * lo que se afirma aquí (quién lo recibe y quién no).
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { addMember, API, call, db, freshDatabase, login, loginSkippingMfa, PASSWORD, startApi, stopApi } from './harness';

const WEB_PORT = 3199;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const WEB_DIR = join(__dirname, '..', '..', '..', 'web');
const suffix = randomUUID().slice(0, 8);
let web: ChildProcess | null = null;
let webLog = '';

async function startWeb(): Promise<void> {
  web = spawn('node', [require.resolve('next/dist/bin/next', { paths: [WEB_DIR] }), 'start', '-p', String(WEB_PORT)], {
    cwd: WEB_DIR,
    env: { ...process.env, KOBRAX_API_URL: API, NODE_ENV: 'production' },
  });
  let log = '';
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`La web no arrancó:\n${log}`)), 90_000);
    const onData = (c: Buffer) => {
      log += c.toString();
      webLog += c.toString();
      if (/ready|started server/i.test(log)) {
        clearTimeout(timer);
        ok();
      }
    };
    web!.stdout!.on('data', onData);
    web!.stderr!.on('data', onData);
    web!.on('exit', (code) => fail(new Error(`La web terminó (${code}):\n${log}`)));
  });
}

async function page(token: string, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${WEB}${path}`, { redirect: 'manual', headers: { Cookie: `k_access=${token}` } });
  // Sin los bloques <script>: Next incrusta TODOS los textos de traducción en la carga de cada página, y eso no es lo que se
  // pinta. Se afirma solo sobre el marcado visible.
  const raw = await res.text();
  return { status: res.status, body: raw.replace(/<script[\s\S]*?<\/script>/g, '') };
}

const WIZARD = 'Te damos la bienvenida a Kobrax';
const out: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  out.push(`${ok ? 'OK  ' : 'FALLA'} ${label} → ${detail}`);
  assert.ok(ok, `${label}: ${detail}`);
};

async function signup(label: string, planCode: string): Promise<{ accountId: string; email: string; token: string }> {
  const email = `dueno-${label}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Cobranzas ${label} ${suffix}`, firstName: 'Dueño', lastName: label, email, password: PASSWORD, planCode }),
  });
  assert.equal(res.status, 201, await res.text());
  const prisma = db();
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  await prisma.$disconnect();
  return { accountId: owner.userAccounts[0]!.accountId, email, token: await loginSkippingMfa(email) };
}

async function main() {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  const prisma = db();
  const free = await signup('free', 'FREE');
  const pro = await signup('pro', 'PROFESSIONAL');
  const biz = await signup('biz', 'BUSINESS');
  await startWeb();

  // 1) Cuenta nueva: el administrador recibe el asistente, en cualquier pantalla del panel.
  for (const path of ['/dashboard', '/cartera', '/agenda']) {
    const r = await page(free.token, path);
    check(`D-14 cuenta nueva ve el asistente en ${path}`, r.status === 200 && r.body.includes(WIZARD) && r.body.includes('aria-modal="true"'), `HTTP ${r.status}`);
  }

  // 2) La recomendación sigue al plan (D-12), con su razón.
  const f = await page(free.token, '/dashboard');
  check('D-12 Free → «Independiente» y su razón', f.body.includes('trabajas solo, así que mostramos lo esencial') && f.body.includes('Independiente'), 'plan FREE');
  const p = await page(pro.token, '/dashboard');
  check('D-12 Professional → «Equipo» y su razón', p.body.includes('pensado para un equipo'), 'plan PROFESSIONAL');
  const b = await page(biz.token, '/dashboard');
  check('D-12 Business → «Completo» y su razón', b.body.includes('dejamos todo visible'), 'plan BUSINESS');

  // 3) Un invitado (sin account:write) no lo recibe, aunque la cuenta esté pendiente.
  const colEmail = `cob-${suffix}@ejemplo.com`;
  await addMember(prisma, free.accountId, colEmail, 'Cob', 'COLLECTOR');
  const col = await login(colEmail);
  const c = await page(col, '/dashboard');
  check('D-14 un invitado no ve el asistente organizacional', c.status === 200 && !c.body.includes(WIZARD), `HTTP ${c.status}`);

  // 4) Una cuenta anterior a F15 (sin estado) no lo recibe.
  await prisma.account.update({ where: { id: pro.accountId }, data: { configuration: {} } });
  const legacy = await page(pro.token, '/dashboard');
  check('A-1 cuenta anterior (sin estado) no recibe el asistente', legacy.status === 200 && !legacy.body.includes(WIZARD), `HTTP ${legacy.status}`);

  // 5) Quien lo omite no lo vuelve a ver (queda `skipped`).
  const skip = await call(free.token, 'PATCH', '/accounts/me', { onboarding: { status: 'skipped' } });
  assert.equal(skip.status, 200, JSON.stringify(skip.error));
  const after = await page(free.token, '/dashboard');
  check('D-14 omitido: no vuelve a salir solo', after.status === 200 && !after.body.includes(WIZARD), `HTTP ${after.status}`);

  // 6) Resuelto con «Terminar»: tampoco, y su workspace queda aplicado en el menú.
  const done = await call(biz.token, 'PATCH', '/accounts/me', {
    workspace: { version: 1, rev: 0, hiddenModules: ['routes', 'export'], options: {} },
    onboarding: { status: 'done', preset: 'custom' },
  });
  assert.equal(done.status, 200, JSON.stringify(done.error));
  const bizAfter = await page(biz.token, '/dashboard');
  check('el asistente terminado no vuelve y el menú refleja lo elegido', !bizAfter.body.includes(WIZARD) && !/href="\/rutas"/.test(bizAfter.body) && /href="\/cartera"/.test(bizAfter.body), 'Rutas y Exportar fuera; Cartera presente');

  // 7) «Revisar con el asistente» siempre está en Cuenta › Espacio de trabajo (también si ya se resolvió).
  const tab = await page(free.token, '/cuenta/espacio-de-trabajo');
  check('D-14 el enlace «Revisar con el asistente» existe en Cuenta', tab.status === 200 && tab.body.includes('Revisar con el asistente') && !tab.body.includes(WIZARD), `HTTP ${tab.status}`);

  await prisma.$disconnect();
  console.log(out.join('\n'));
  console.log(`\n${out.length}/${out.length} comprobaciones OK`);
}

main()
  .catch((e) => {
    console.log(out.join('\n'));
    console.error(e);
    console.error(`--- log de la web ---\n${webLog.slice(-3000)}`);
    process.exitCode = 1;
  })
  .finally(() => {
    web?.kill();
    stopApi();
  });
