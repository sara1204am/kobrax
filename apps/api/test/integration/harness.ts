/**
 * Pruebas de integración contra una base REAL y la API REAL compilada (P8).
 *
 * Lo que los tests unitarios no pueden afirmar —que el guard deja o no deja pasar, que el multipart
 * llega, que la RLS acepta la escritura, que la tabla y la columna quedan iguales— se prueba acá:
 *
 *   1. Una base aparte, `kobrax_it`, recreada de cero en cada corrida (la de desarrollo no se toca).
 *   2. Migraciones + RLS + seed, como en un entorno nuevo.
 *   3. `node dist/main.js` apuntando a esa base, en otro puerto. Se le habla por HTTP.
 *
 * 🔴 **Por qué la API compilada y no `NestFactory` dentro del test:** los tests corren con `tsx`
 * (esbuild), que no emite la metadata de decoradores de la que vive la inyección de Nest. Compilado
 * con `nest build` es exactamente lo que corre en producción.
 *
 * Requiere el Postgres de desarrollo levantado (docker `kobrax-postgres`, o `IT_PG_CONTAINER`) y
 * Redis. Los scripts de RLS se aplican con el `psql` del contenedor: traen bloques `DO $$` que un
 * cliente de una sentencia por vez no puede ejecutar.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const API_DIR = process.cwd(); // `pnpm test:integration` corre en apps/api
const ROOT = resolve(API_DIR, '../..');
const DB_DIR = join(ROOT, 'packages/database');
const TEST_DB = 'kobrax_it';
const PORT = Number(process.env.IT_API_PORT ?? 4099);
const CONTAINER = process.env.IT_PG_CONTAINER ?? 'kobrax-postgres';
export const PASSWORD = 'Kobrax123!';
export const API = `http://127.0.0.1:${PORT}/api`;
export const REPORTS = join(ROOT, 'docs/flows/psf-diario');

/** `.env` simple: KEY=valor, comillas opcionales. Lo justo para no depender de dotenv. */
function readEnv(file: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .map((l) => /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(l))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => [m[1]!, m[2]!]),
    );
  } catch {
    return {};
  }
}

const ENV = { ...readEnv(join(DB_DIR, '.env')), ...readEnv(join(ROOT, '.env')), ...process.env } as Record<string, string>;
const withDb = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};
const SUPER_URL = withDb(ENV.DATABASE_URL!, TEST_DB);
const APP_URL = withDb(ENV.APP_DATABASE_URL!, TEST_DB);

function run(cmd: string, args: string[], cwd: string, input?: string): void {
  // `npx` en Windows es un .cmd y necesita shell; `docker` no, y con shell perdería las comillas del `sh -c`.
  const shell = process.platform === 'win32' && cmd === 'npx';
  const r = spawnSync(cmd, args, { cwd, input, env: { ...ENV, DATABASE_URL: SUPER_URL }, shell, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} falló:\n${r.stdout}\n${r.stderr}`);
}

/** Base nueva: se borra y se crea. Migraciones, RLS y el seed completo (roles, cuenta demo, usuarios). */
export async function freshDatabase(): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: withDb(ENV.DATABASE_URL!, 'postgres') } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.$executeRawUnsafe(`CREATE DATABASE ${TEST_DB}`);
  await admin.$disconnect();

  /*
   * 🔴 Tres migraciones (import runs, agenda, historial) crean policies con `app_current_account()`,
   * que define `rls/001` — y `rls/001` no puede correr antes de que existan las tablas. En una base
   * que ya tenía todo no se nota; en una nueva, `migrate deploy` se cae. Se crea el helper solo,
   * igual que lo hace 001 (que después lo recrea con CASCADE y vuelve a poner las policies).
   */
  psql(`CREATE FUNCTION app_current_account() RETURNS text AS $$
  SELECT NULLIF(current_setting('app.current_account_id', true), '');
$$ LANGUAGE sql STABLE;`);
  run('npx', ['prisma', 'migrate', 'deploy'], DB_DIR);
  const rls = readdirSync(join(DB_DIR, 'prisma/rls'))
    .filter((f) => f.endsWith('.sql') && !f.startsWith('verify'))
    .sort();
  for (const file of rls) psql(readFileSync(join(DB_DIR, 'prisma/rls', file), 'utf8'));
  run('npx', ['tsx', 'prisma/seed.ts'], DB_DIR);
}

/** SQL con varias sentencias y bloques `DO $$`, por el `psql` del contenedor. */
function psql(sql: string): void {
  run('docker', ['exec', '-i', CONTAINER, 'sh', '-c', `psql -U "$POSTGRES_USER" -d ${TEST_DB} -v ON_ERROR_STOP=1 -q`], ROOT, sql);
}

/** Cliente superusuario de la base de prueba: para preparar datos y mirar lo que quedó. */
export const db = () => new PrismaClient({ datasources: { db: { url: SUPER_URL } } });

/**
 * Cliente con el rol de la API (`kobrax_app`, NOBYPASSRLS) sobre la base de prueba: para consultar CRUDO, sin pasar por ningún helper
 * de la app, y ver lo que la base niega por sí sola (F14 · F2b).
 */
export const appDb = () => new PrismaClient({ datasources: { db: { url: APP_URL } } });

/** Lo que el servidor de Postgres de la prueba escribió en su log desde `since` (ISO): para ver los `RAISE LOG` del modo `log`. */
export function postgresLogSince(since: string): string {
  const r = spawnSync('docker', ['logs', '--since', since, CONTAINER], { encoding: 'utf8' });
  return `${r.stdout}\n${r.stderr}`;
}

/** Un usuario más en la cuenta de la demo, con el rol pedido. */
export async function addMember(prisma: PrismaClient, accountId: string, email: string, firstName: string, roleName: string): Promise<string> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await hash(PASSWORD, 10),
      status: 'ACTIVE',
      requiresPasswordChange: false,
      profile: { create: { firstName, lastName: 'Prueba' } },
    },
  });
  await prisma.userAccount.create({ data: { userId: user.id, accountId, roleId: role.id } });
  return user.id;
}

let api: ChildProcess | null = null;

/** La API compilada contra la base de prueba. Resuelve cuando escucha. */
export async function startApi(extraEnv: Record<string, string> = {}): Promise<void> {
  const uploads = mkdtempSync(join(tmpdir(), 'kobrax-it-'));
  api = spawn('node', ['dist/main.js'], {
    cwd: API_DIR,
    env: { ...ENV, NODE_ENV: 'test', API_PORT: String(PORT), APP_DATABASE_URL: APP_URL, DATABASE_URL: SUPER_URL, UPLOADS_DIR: uploads, ...extraEnv },
  });
  let log = '';
  await new Promise<void>((ok, fail) => {
    const timer = setTimeout(() => fail(new Error(`La API no arrancó en 120 s:\n${log}`)), 120_000);
    const onData = (chunk: Buffer) => {
      log += chunk.toString();
      if (log.includes('escuchando')) {
        clearTimeout(timer);
        ok();
      }
    };
    api!.stdout!.on('data', onData);
    api!.stderr!.on('data', onData);
    api!.on('exit', (code) => fail(new Error(`La API terminó (${code}):\n${log}`)));
  });
}

export function stopApi(): void {
  api?.kill();
  api = null;
}

// ── Llamadas ─────────────────────────────────────────────────────────────────

export interface Envelope<T> {
  status: number;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

async function envelope<T>(res: Response): Promise<Envelope<T>> {
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: Envelope<T>['error'] };
  return { status: res.status, data: body.data, error: body.error ?? undefined };
}

export async function login(email: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = (await res.json()) as { data?: { step: string; accessToken?: string } };
  if (body.data?.step !== 'done' || !body.data.accessToken) throw new Error(`login de ${email}: ${JSON.stringify(body)}`);
  return body.data.accessToken;
}

/**
 * Login de un rol CRÍTICO (ACCOUNT_ADMIN) sin enrolar TOTP: exige que la API haya arrancado con `MFA_CRITICAL_GRACE_UNTIL`
 * en el futuro (`startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' })`). Lo que se prueba no es el segundo factor.
 */
export async function loginSkippingMfa(email: string): Promise<string> {
  const post = async (path: string, body: unknown) =>
    (await (await fetch(`${API}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()) as {
      data?: { step: string; accessToken?: string; preAuthToken?: string };
    };
  const first = await post('/auth/login', { email, password: PASSWORD });
  if (first.data?.step === 'done' && first.data.accessToken) return first.data.accessToken;
  if (first.data?.step !== 'mfa_setup' || !first.data.preAuthToken) throw new Error(`login de ${email}: ${JSON.stringify(first)}`);
  const skipped = await post('/auth/mfa/setup/skip', { preAuthToken: first.data.preAuthToken });
  if (skipped.data?.step !== 'done' || !skipped.data.accessToken) throw new Error(`mfa/setup/skip de ${email}: ${JSON.stringify(skipped)}`);
  return skipped.data.accessToken;
}

export async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<Envelope<T>> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return envelope<T>(res);
}

/** Sube un reporte de `docs/flows/psf-diario`, como la pantalla: multipart con el archivo y los campos. */
export async function importReport<T>(token: string, file: string, opts: { dryRun?: boolean; assignments?: unknown } = {}): Promise<Envelope<T>> {
  const form = new FormData();
  form.append('file', new Blob([readFileSync(join(REPORTS, file))], { type: 'application/pdf' }), file);
  form.append('dryRun', String(opts.dryRun ?? false));
  if (opts.assignments) form.append('assignments', JSON.stringify(opts.assignments));
  const res = await fetch(`${API}/imports/portfolio`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  return envelope<T>(res);
}

/** Las tablas con policy de alcance de F2b (`rls/006_scope_policies.sql`). */
export const SCOPE_TABLES = ['credits', 'clients', 'payments', 'agenda_items', 'route_plans'] as const;

/** Ejecuta SQL como superusuario sobre la base de pruebas, vía psql dentro del contenedor. Falla (lanza) si el SQL falla. */
export function psqlTest(sql: string): void {
  const r = spawnSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', TEST_DB, '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`psql falló (${r.status}): ${r.stderr}`);
}

/** Instala (re-aplica `rls/006`) o quita las policies de alcance: para medir contra la línea base «sin F2b». */
export function installScopePolicies(): void {
  psqlTest(readFileSync(join(__dirname, '../../../../packages/database/prisma/rls/006_scope_policies.sql'), 'utf8'));
}
export function uninstallScopePolicies(): void {
  psqlTest(SCOPE_TABLES.map((t) => `DROP POLICY IF EXISTS scope_${t} ON ${t};`).join(' '));
}
