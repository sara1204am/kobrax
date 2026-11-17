/**
 * F15 · P8 — verificación REAL de la bienvenida del invitado y los «primeros pasos»: API compilada + Postgres/Redis reales +
 * `next start` de la web, con sesiones de verdad. NO es parte de `test:integration` (necesita `next build` y un segundo
 * servidor): se corre a mano y su salida va a `docs/epics/F15/execution/VERIFICATIONS.md`.
 *
 *   pnpm --filter @kobrax/api build && (cd apps/web && rm -rf .next && npx next build)
 *   cd apps/api && node --import tsx test/integration/p8-web-cards.real.ts
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  addMember,
  API,
  call,
  db,
  freshDatabase,
  login,
  loginSkippingMfa,
  PASSWORD,
  startApi,
  stopApi,
} from './harness';

const WEB_PORT = 3199;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const WEB_DIR = join(__dirname, '..', '..', '..', 'web');
const suffix = randomUUID().slice(0, 8);
let web: ChildProcess | null = null;
let webLog = '';

async function startWeb(): Promise<void> {
  web = spawn(
    'node',
    [require.resolve('next/dist/bin/next', { paths: [WEB_DIR] }), 'start', '-p', String(WEB_PORT)],
    {
      cwd: WEB_DIR,
      env: { ...process.env, KOBRAX_API_URL: API, NODE_ENV: 'production' },
    },
  );
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

/** El marcado visible de una pantalla (sin los bloques <script>, donde Next incrusta todos los textos de traducción). */
async function page(token: string, path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${WEB}${path}`, {
    redirect: 'manual',
    headers: { Cookie: `k_access=${token}` },
  });
  const raw = await res.text();
  return { status: res.status, body: raw.replace(/<script[\s\S]*?<\/script>/g, '') };
}

const out: string[] = [];
const check = (label: string, ok: boolean, detail: string) => {
  out.push(`${ok ? 'OK  ' : 'FALLA'} ${label} → ${detail}`);
  assert.ok(ok, `${label}: ${detail}`);
};

const WELCOME = 'id="welcome-card-title"';
const STEPS = 'id="first-steps-title"';

async function main() {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  const prisma = db();

  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      businessName: `Cobranzas ${suffix}`,
      firstName: 'Dueño',
      lastName: 'Prueba',
      email,
      password: PASSWORD,
      planCode: 'PROFESSIONAL',
    }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({
    where: { email },
    include: { userAccounts: true },
  });
  const accountId = owner.userAccounts[0]!.accountId;
  const ownerToken = await loginSkippingMfa(email);

  const colEmail = `cob-${suffix}@ejemplo.com`;
  await addMember(prisma, accountId, colEmail, 'Cob', 'COLLECTOR');
  const colToken = await login(colEmail);
  await startWeb();

  // 1) El administrador resuelve el asistente: ya no lo ve, y SÍ ve los primeros pasos en Inicio (no la bienvenida si el
  //    asistente la marcó; aquí simulamos que no la marcó).
  const done = await call(ownerToken, 'PATCH', '/accounts/me', { onboarding: { status: 'done' } });
  assert.equal(done.status, 200, JSON.stringify(done.error));
  const home = await page(ownerToken, '/dashboard');
  check(
    'P8 el administrador ve los «primeros pasos» en Inicio',
    home.status === 200 && home.body.includes(STEPS),
    `HTTP ${home.status}`,
  );
  check(
    'P8 …con tareas reales y enlaces (cliente, crédito, pago)',
    /href="\/cartera"[^>]*>Registra tu primer cliente</.test(home.body) &&
      />Registra tu primer pago</.test(home.body),
    'tres tareas pendientes en una cuenta vacía',
  );

  // 2) Solo en las pantallas de aterrizaje.
  const cartera = await page(ownerToken, '/cartera');
  check(
    'P8 las tarjetas no salen en otras pantallas (Cartera)',
    cartera.status === 200 && !cartera.body.includes(STEPS) && !cartera.body.includes(WELCOME),
    `HTTP ${cartera.status}`,
  );

  // 3) El invitado (cobrador, sin Inicio): su aterrizaje es la Agenda; ahí ve la bienvenida con su rol y los módulos.
  const agenda = await page(colToken, '/agenda');
  check(
    'P8 el invitado ve la bienvenida en su aterrizaje (Agenda)',
    agenda.status === 200 && agenda.body.includes(WELCOME),
    `HTTP ${agenda.status}`,
  );
  check(
    'P8 …con el nombre de la organización y su rol',
    agenda.body.includes(`Cobranzas ${suffix}`) && agenda.body.includes('Tu rol es Cobrador.'),
    'organización y rol traducido',
  );

  // 4) El BFF mezcla el parche: marcar la bienvenida NO borra lo demás, y el servidor guarda lo de esa persona.
  const patch = async (token: string, body: unknown) =>
    fetch(`${WEB}/api/users/me/guides`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: `k_access=${token}`, Origin: WEB },
      body: JSON.stringify(body),
    });
  const closed = await patch(ownerToken, { firstStepsClosed: true });
  assert.equal(closed.status, 200, await closed.text());
  const seen = await patch(ownerToken, { welcomeSeen: true });
  assert.equal(seen.status, 200, await seen.text());
  const state = await call<{ welcomeSeen: boolean; firstStepsClosed: boolean }>(
    ownerToken,
    'GET',
    '/users/me/guides',
  );
  check(
    'P8 el BFF mezcla los parches: no se borran entre sí',
    state.data?.welcomeSeen === true && state.data?.firstStepsClosed === true,
    JSON.stringify(state.data),
  );
  const after = await page(ownerToken, '/dashboard');
  check(
    'P8 cerradas, las tarjetas no vuelven',
    !after.body.includes(STEPS) && !after.body.includes(WELCOME),
    `HTTP ${after.status}`,
  );

  // 5) El estado es de cada persona: lo del administrador no toca al invitado.
  const colState = await call<{ welcomeSeen: boolean }>(colToken, 'GET', '/users/me/guides');
  check(
    'P8 el estado es por persona: el invitado conserva el suyo',
    colState.data?.welcomeSeen === false,
    JSON.stringify(colState.data),
  );
  const csrf = await fetch(`${WEB}/api/users/me/guides`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `k_access=${colToken}`,
      Origin: 'https://otro.example',
    },
    body: JSON.stringify({ welcomeSeen: true }),
  });
  check('P8 el BFF rechaza otro origen (CSRF)', csrf.status === 403, `HTTP ${csrf.status}`);
  const still = await call<{ welcomeSeen: boolean }>(colToken, 'GET', '/users/me/guides');
  check('P8 …y no guardó nada', still.data?.welcomeSeen === false, 'sigue sin verla');

  // 6) El invitado la cierra y no vuelve.
  assert.equal((await patch(colToken, { welcomeSeen: true })).status, 200);
  const colAfter = await page(colToken, '/agenda');
  check(
    'P8 el invitado cierra la bienvenida y no vuelve',
    colAfter.status === 200 && !colAfter.body.includes(WELCOME),
    `HTTP ${colAfter.status}`,
  );

  // 7) Una cuenta anterior a F15 (sin estado) no recibe nada.
  await prisma.account.update({ where: { id: accountId }, data: { configuration: {} } });
  await prisma.userGuideState.deleteMany({ where: { accountId } });
  const legacyOwner = await page(ownerToken, '/dashboard');
  const legacyCol = await page(colToken, '/agenda');
  check(
    'A-1 una cuenta anterior (sin estado) no recibe ninguna tarjeta',
    !legacyOwner.body.includes(STEPS) &&
      !legacyOwner.body.includes(WELCOME) &&
      !legacyCol.body.includes(WELCOME),
    'ni administrador ni invitado',
  );

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
