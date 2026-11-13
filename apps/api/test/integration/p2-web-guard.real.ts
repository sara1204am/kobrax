/**
 * F15 · P2 — verificación REAL del guard de módulos ocultos (plan H-16, C-7): API compilada + Postgres/Redis reales +
 * `next start` de la web, con una sesión de verdad. NO es parte del script `test:integration` (necesita `next build` y un
 * segundo servidor): se corre a mano y su salida va a `docs/epics/F15/execution/VERIFICATIONS.md`.
 *
 *   pnpm --filter @kobrax/api build && (cd apps/web && npx next build)
 *   cd apps/api && node --import tsx test/integration/p2-web-guard.real.ts
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { API, call, db, freshDatabase, loginSkippingMfa, PASSWORD, startApi, stopApi } from './harness';

const WEB_PORT = 3199;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const WEB_DIR = join(__dirname, '..', '..', '..', 'web');
const suffix = randomUUID().slice(0, 8);
let web: ChildProcess | null = null;
let token = '';

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

/** El árbol de estado que el navegador envía al navegar suavemente DESDE `/cartera` (lo que ya tiene montado). */
const FROM_CARTERA = encodeURIComponent(JSON.stringify(['', { children: ['(panel)', { children: ['cartera', { children: ['__PAGE__', {}] }] }] }, null, null, true]));

async function get(path: string, rsc = false): Promise<{ status: number; location: string | null; body: string }> {
  const res = await fetch(`${WEB}${path}`, {
    redirect: 'manual',
    headers: { Cookie: `k_access=${token}`, ...(rsc ? { RSC: '1', 'Next-Router-State-Tree': FROM_CARTERA, 'Next-Url': '/cartera' } : {}) },
  });
  return { status: res.status, location: res.headers.get('location'), body: await res.text() };
}


/**
 * ¿La respuesta manda a `url`? Next puede hacerlo de dos formas: un 307 con `Location`, o —cuando la pantalla ya empezó a
 * transmitirse por el `loading.tsx` del panel— un 200 cuyo documento trae `<meta http-equiv="refresh" … url=…>` y el
 * redirect del cliente. En las dos el contenido del módulo oculto NO se pinta: el layout lanza antes de renderlo.
 */
const redirectsTo = (r: { status: number; location: string | null; body: string }, url: string): boolean =>
  (r.status === 307 && r.location === url) || (r.status === 200 && r.body.includes(`http-equiv="refresh" content="1;url=${url}"`));

const setHidden = async (rev: number, hiddenModules: string[]) => {
  const r = await call<{ workspace: { rev: number } }>(token, 'PATCH', '/accounts/me', { workspace: { version: 1, rev, hiddenModules, options: {} } });
  assert.equal(r.status, 200, JSON.stringify(r.error));
  return r.data!.workspace.rev;
};

async function main() {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  const prisma = db();
  const email = `dueno-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Cobranzas ${suffix}`, firstName: 'Dueño', lastName: 'Prueba', email, password: PASSWORD, planCode: 'PROFESSIONAL' }),
  });
  assert.equal(res.status, 201, await res.text());
  token = await loginSkippingMfa(email);
  await startWeb();

  const out: string[] = [];
  const check = (label: string, ok: boolean, detail: string) => {
    out.push(`${ok ? 'OK  ' : 'FALLA'} ${label} → ${detail}`);
    assert.ok(ok, `${label}: ${detail}`);
  };

  // 1) «Completo»: ninguna ruta redirige (A-1).
  for (const path of ['/rutas', '/equipo', '/organizacion', '/import', '/exportar', '/actividad', '/cartera']) {
    const r = await get(path);
    check(`A-1 Completo ${path}`, r.status === 200, `HTTP ${r.status}`);
  }

  // 2) Se ocultan Rutas y Exportar (con una persona: S-1/S-7 no bloquean; sin rutas en curso).
  let rev = await setHidden(0, ['routes', 'export']);
  for (const path of ['/rutas', '/rutas/planificar', '/rutas/abc-123']) {
    const r = await get(path);
    check(`A-4 oculto ${path}`, redirectsTo(r, '/dashboard?oculto=routes'), `HTTP ${r.status} Location ${r.location}`);
  }
  const exp = await get('/exportar');
  check('A-4 oculto /exportar', redirectsTo(exp, '/dashboard?oculto=export'), `HTTP ${exp.status} Location ${exp.location}`);

  // 3) Lo que NO se ocultó sigue abriendo, y los troncales también (A-2, D-5).
  for (const path of ['/equipo', '/organizacion', '/import', '/actividad', '/cartera', '/seguridad', '/cuenta']) {
    const r = await get(path);
    check(`visible ${path}`, r.status === 200, `HTTP ${r.status}`);
  }

  // 4) Navegación suave: la petición RSC que hace el navegador al entrar a otro módulo (C-7, H-16).
  const soft = await get('/rutas', true);
  check('C-7 navegación suave (RSC, desde /cartera) a un módulo oculto: el servidor responde con el redirect', soft.body.replaceAll('\\/', '/').includes('NEXT_REDIRECT;replace;/dashboard?oculto=routes') || redirectsTo(soft, '/dashboard?oculto=routes'), `HTTP ${soft.status}, ${soft.body.length} bytes`);
  check('C-7 …y NO manda el contenido de Rutas', !/PlanScreen|RouteEditor|Planificar mi ruta/.test(soft.body), 'sin contenido del módulo oculto');

  // 5) El aviso se pinta en la pantalla a la que se volvió, y el menú ya no trae lo oculto.
  const home = await get('/dashboard?oculto=routes');
  check('el aviso aparece en Inicio', home.status === 200 && home.body.includes('Rutas está oculto para tu organización'), `HTTP ${home.status}`);
  check('el menú no trae /rutas ni /exportar', !/href="\/rutas"/.test(home.body) && !/href="\/exportar"/.test(home.body), 'sin enlaces del menú a los módulos ocultos');
  check('el menú sí trae lo visible', /href="\/cartera"/.test(home.body) && /href="\/mora"/.test(home.body) && /href="\/cuenta"/.test(home.body), 'Cartera, Mora y Cuenta (troncales) presentes');
  const bad = await get('/dashboard?oculto=portfolio');
  check('una clave que no es ocultable no escribe aviso', !bad.body.includes('Cartera está oculto') && !bad.body.includes('portfolio está oculto'), 'sin aviso (el texto traducido viaja en el documento, el aviso renderizado no)');

  // 6) Volver a «Completo» reabre todo.
  rev = await setHidden(rev, []);
  const back = await get('/rutas');
  check('reversible: vuelve a abrir /rutas', back.status === 200, `HTTP ${back.status}`);

  // ── P4: la pestaña «Espacio de trabajo» y el guardado por el BFF ──
  const pageWs = await get('/cuenta/espacio-de-trabajo');
  check('P4 la pestaña abre (200) con el formulario', pageWs.status === 200 && pageWs.body.includes('Punto de partida') && pageWs.body.includes('Guardar cambios'), `HTTP ${pageWs.status}`);
  // (La lista de pestañas de Cuenta se verifica en `cuenta-tabs.test.ts`: el HTML del servidor no trae esos enlaces, tampoco los de las demás pestañas.)

  const patchBff = (body: unknown, origin = WEB) =>
    fetch(`${WEB}/api/account/me`, { method: 'PATCH', headers: { Cookie: `k_access=${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const saved1 = await patchBff({ workspace: { version: 1, rev, hiddenModules: ['import'], options: { 'client.income': false } } });
  const saved1Body = (await saved1.json()) as { workspace?: { rev: number; hiddenModules: string[] } };
  check('P4 guardar por el BFF (200) y sube el rev', saved1.status === 200 && saved1Body.workspace?.rev === rev + 1 && saved1Body.workspace.hiddenModules.join() === 'import', `HTTP ${saved1.status} rev ${saved1Body.workspace?.rev}`);
  const importHidden = await get('/import');
  check('P4 lo guardado ya se aplica: /import oculto', redirectsTo(importHidden, '/dashboard?oculto=import'), `HTTP ${importHidden.status}`);

  const stale = await patchBff({ workspace: { version: 1, rev, hiddenModules: [], options: {} } });
  const staleBody = (await stale.json()) as { error?: { code: string; details?: { reason: string; currentRev: number } } };
  check('P4 un rev viejo por el BFF → 409 con el código y el rev vigente', stale.status === 409 && staleBody.error?.code === 'WORKSPACE_CONFLICT' && staleBody.error.details?.currentRev === rev + 1, `HTTP ${stale.status} ${JSON.stringify(staleBody.error)}`);

  const foreign = await patchBff({ workspace: { version: 1, rev: rev + 1, hiddenModules: [], options: {} } }, 'https://otro-sitio.example');
  check('P4 un origen ajeno se rechaza (CSRF)', foreign.status === 403, `HTTP ${foreign.status}`);

  const reset = await patchBff({ workspace: { version: 1, rev: rev + 1, hiddenModules: [], options: {} } });
  check('P4 «Restablecer a Completo» guarda y reabre todo', reset.status === 200 && (await get('/import')).status === 200, `HTTP ${reset.status}`);

  console.log(out.join('\n'));
  await prisma.$disconnect();
}

main()
  .then(() => {
    web?.kill();
    stopApi();
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    web?.kill();
    stopApi();
    process.exit(1);
  });
