import 'reflect-metadata';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Reflector } from '@nestjs/core';
import { resolveAccess } from './auth/authz-access';
import { POLICIES } from '../common/authz/policies';

/**
 * F14 · F3 — cobertura TOTAL del contrato de acceso (ADR-F14-03).
 *
 * Recorre todos los controladores de la API y exige que CADA handler HTTP tenga un contrato resuelto (público, autenticado o
 * permisos). La tabla resultante se compara con `docs/epics/F14/authz-snapshot.json`: cambiar una puerta obliga a cambiar el
 * snapshot en el mismo commit, y el snapshot lo aprueba la usuaria. Regenerar: `UPDATE_AUTHZ_SNAPSHOT=1 pnpm test`.
 */
const SRC = resolve(__dirname, '..');
const SNAPSHOT = resolve(__dirname, '../../../../docs/epics/F14/authz-snapshot.json');
const HTTP = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'];

interface Row {
  route: string;
  handler: string;
  kind: string;
  all: string[];
  any: string[];
  policy?: string;
  destructive?: boolean;
}

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : controllerFiles(full);
    return name.endsWith('.controller.ts') ? [full] : [];
  });
}

async function collect(): Promise<{ rows: Row[]; undeclared: string[] }> {
  const reflector = new Reflector();
  const rows: Row[] = [];
  const undeclared: string[] = [];
  for (const file of controllerFiles(SRC).sort()) {
    const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    for (const cls of Object.values(mod)) {
      if (typeof cls !== 'function' || Reflect.getMetadata('path', cls) === undefined) continue;
      const base = String(Reflect.getMetadata('path', cls)).replace(/^\/|\/$/g, '');
      for (const name of Object.getOwnPropertyNames(cls.prototype)) {
        const fn = (cls.prototype as Record<string, unknown>)[name];
        if (typeof fn !== 'function' || Reflect.getMetadata('method', fn) === undefined) continue;
        const verb = HTTP[Reflect.getMetadata('method', fn) as number] ?? '?';
        const sub = String(Reflect.getMetadata('path', fn) ?? '').replace(/^\/|\/$/g, '');
        const route = `${verb} /${[base, sub].filter(Boolean).join('/')}`;
        const handler = `${cls.name}.${name}`;
        const access = resolveAccess(reflector, fn, cls);
        if (!access) {
          undeclared.push(`${route}  (${handler})`);
          continue;
        }
        rows.push(
          access.kind === 'permissions'
            ? { route, handler, kind: 'permissions', all: [...access.all].sort(), any: [...access.any].sort(), ...(access.policy ? { policy: access.policy } : {}), ...(access.destructive ? { destructive: true } : {}) }
            : { route, handler, kind: access.kind, all: [], any: [] },
        );
      }
    }
  }
  rows.sort((a, b) => (a.route + a.handler).localeCompare(b.route + b.handler));
  return { rows, undeclared };
}

describe('F14·F3 — cobertura del contrato de acceso', () => {
  it('🔴 todo handler HTTP declara su acceso (público, autenticado o permisos): sin declarar se niega', async () => {
    const { rows, undeclared } = await collect();
    assert.ok(rows.length + undeclared.length > 150, 'el recorrido debe encontrar los controladores');
    assert.deepEqual(undeclared, [], `Handlers sin contrato (${undeclared.length}):\n${undeclared.join('\n')}`);
  });

  it('el snapshot de puertas coincide (cambiar una puerta = cambiar docs/epics/F14/authz-snapshot.json)', async () => {
    const { rows } = await collect();
    if (process.env.UPDATE_AUTHZ_SNAPSHOT === '1') {
      writeFileSync(SNAPSHOT, JSON.stringify(rows, null, 2) + '\n', 'utf-8');
    }
    assert.ok(existsSync(SNAPSHOT), `Falta ${SNAPSHOT}: no se regenera sola (UPDATE_AUTHZ_SNAPSHOT=1 para crearlo)`);
    const expected = JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) as Row[];
    assert.deepEqual(rows, expected, 'Una puerta cambió: revisa el diff y actualiza el snapshot (UPDATE_AUTHZ_SNAPSHOT=1) en el mismo commit');
  });

  it('toda @Policy declarada existe en el registro de políticas (un nombre mal escrito no pasa en silencio)', async () => {
    const { rows } = await collect();
    const names = new Set(POLICIES.map((p) => p.name));
    for (const r of rows) if (r.policy) assert.ok(names.has(r.policy), `${r.route} declara @Policy('${r.policy}') que no existe`);
  });

  it('las rutas públicas son una lista cerrada (login, alta de cuenta, invitaciones, salud…)', async () => {
    const { rows } = await collect();
    const publics = rows.filter((r) => r.kind === 'public').map((r) => r.route);
    assert.ok(publics.length > 0 && publics.length <= 25, `públicos: ${publics.length}`);
    // F14 · F4: la ÚNICA ruta pública fuera de esas tres es la lectura por enlace firmado (`GET /files/:id/raw`): la credencial es la firma HMAC
    // (cuenta + archivo + vencimiento de 5 minutos), con límite de peticiones; ver `FilesController.raw`.
    for (const r of publics) assert.match(r, /\/(auth|accounts|health)\b|^GET \/files\/:id\/raw$/, `ruta pública fuera de auth/accounts/health: ${r}`);
  });

  it('ninguna ruta crea, edita o promueve a un usuario de plataforma (H-11)', async () => {
    const { rows } = await collect();
    assert.deepEqual(rows.filter((r) => /platform[-_]?users?|super[-_]?admin/i.test(r.route)), []);
  });
});

describe('F14·F3 — un solo punto de decisión de permisos', () => {
  /** Resolvedores de alcance que reciben la capacidad como parámetro: lista blanca justificada (R4 del plan). */
  const WHITELIST = ['common/authz/authorization.service.ts', 'common/office-scope/office-scope.service.ts', 'modules/mora/mora-query.ts'];
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return sources(full);
      return name.endsWith('.ts') && !name.endsWith('.spec.ts') ? [full] : [];
    });
  }
  const rel = (f: string) => f.slice(SRC.length + 1).split(sep).join('/');

  it('🔴 `tenant.can(` sólo aparece en la lista blanca (el resto usa AuthorizationService)', () => {
    const offenders = sources(SRC)
      .map(rel)
      .filter((r) => !WHITELIST.includes(r))
      .filter((r) => /tenant\.can\(/.test(readFileSync(join(SRC, r), 'utf-8')));
    assert.deepEqual(offenders, []);
  });

  it('no queda ningún @UseGuards de autenticación/permisos en los controladores (los guards son globales)', () => {
    const offenders = controllerFiles(SRC)
      .filter((f) => /@UseGuards\([^)]*(JwtAuthGuard|TenantGuard|RolesGuard)/.test(readFileSync(f, 'utf-8')))
      .map(rel);
    assert.deepEqual(offenders, []);
  });
});
