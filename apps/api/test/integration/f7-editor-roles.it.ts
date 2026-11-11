/**
 * F14 · F7 — editor de roles y permisos, de punta a punta.
 *
 * Postgres y Redis reales (base `kobrax_it`) y la API compilada. El recurso es `/roles` (D-1, opción B): el contrato histórico de
 * `GET /roles` NO cambia, y el editor cuelga del mismo recurso.
 *
 *   pnpm --filter @kobrax/api build && node --import tsx --test test/integration/f7-editor-roles.it.ts
 */
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { Permission, PERMISSION_META } from '@kobrax/shared';
import type { PermissionCatalogEntry, RoleCompare, RoleDetail, RoleHistoryPage, RoleSummary, RoleUpdateResult } from '@kobrax/shared';
import { API, addMember, call, db, freshDatabase, login, loginSkippingMfa, startApi, stopApi } from './harness';

const suffix = randomUUID().slice(0, 8);
let prisma: PrismaClient;
const acc: Record<string, { id: string; admin: string }> = {};
let manager = '';
let collector = '';
const collectorEmail = `cobrador-${suffix}@ejemplo.com`;

async function signup(label: string): Promise<{ id: string; admin: string }> {
  const email = `${label}-${suffix}@ejemplo.com`;
  const res = await fetch(`${API}/accounts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ businessName: `Empresa ${label}`, firstName: 'Dueño', lastName: label, email, password: 'Kobrax123!' }),
  });
  assert.equal(res.status, 201, await res.text());
  const owner = await prisma.user.findUniqueOrThrow({ where: { email }, include: { userAccounts: true } });
  return { id: owner.userAccounts[0]!.accountId, admin: await loginSkippingMfa(email) };
}

before(async () => {
  await freshDatabase();
  await startApi({ MFA_CRITICAL_GRACE_UNTIL: '2099-01-01' });
  prisma = db();
  acc.A = await signup('a');
  acc.B = await signup('b');
  await addMember(prisma, acc.A!.id, `gerente-${suffix}@ejemplo.com`, 'Gerente', 'MANAGER');
  await addMember(prisma, acc.A!.id, collectorEmail, 'Cobrador', 'COLLECTOR');
  manager = await login(`gerente-${suffix}@ejemplo.com`);
  collector = await login(collectorEmail);
});

after(async () => {
  stopApi();
  await prisma?.$disconnect();
});

/** Un permiso concedible, de riesgo bajo y sin dependencias pendientes, que el rol aún NO tiene. */
async function candidateFor(role: RoleDetail): Promise<string> {
  const catalog = (await call<PermissionCatalogEntry[]>(acc.A!.admin, 'GET', '/roles/permissions')).data!;
  const has = new Set(role.granted);
  const c = catalog.find((p) => !has.has(p.code) && !p.reserved && !p.code.startsWith('data:scope:') && p.requires.every((r) => has.has(r)));
  assert.ok(c, 'hay algún permiso que añadir');
  return c.code;
}

describe('F7 · GET /roles conserva su contrato (D-1, opción B)', () => {
  it('🔴 sin parámetros devuelve sólo los asignables con EXACTAMENTE { id, name, level }, igual que antes', async () => {
    const res = await call<Record<string, unknown>[]>(acc.A!.admin, 'GET', '/roles');
    assert.equal(res.status, 200);
    assert.ok(res.data!.length > 0);
    for (const r of res.data!) assert.deepEqual(Object.keys(r).sort(), ['id', 'level', 'name']);
    assert.ok(!res.data!.some((r) => r.name === 'ACCOUNT_ADMIN'), 'nunca el reservado');
  });

  it('un gerente (role:read) lo sigue leyendo y sólo ve roles inferiores al suyo', async () => {
    const res = await call<{ name: string; level: number }[]>(manager, 'GET', '/roles');
    assert.equal(res.status, 200);
    assert.ok(res.data!.every((r) => r.level < 70));
  });

  it('un cobrador (sin role:read) sigue sin poder leerlo', async () => {
    assert.equal((await call(collector, 'GET', '/roles')).status, 403);
  });
});

describe('F7 · lectura para el administrador', () => {
  it('`?assignable=false` devuelve todos los roles de la cuenta con su detalle', async () => {
    const res = await call<RoleSummary[]>(acc.A!.admin, 'GET', '/roles?assignable=false');
    assert.equal(res.status, 200);
    const keys = res.data!.map((r) => r.key).sort();
    assert.deepEqual(keys, ['ACCOUNT_ADMIN', 'AUDITOR', 'COLLECTOR', 'MANAGER', 'SUPERVISOR', 'VIEWER']);
    const mgr = res.data!.find((r) => r.key === 'MANAGER')!;
    assert.equal(mgr.source, 'TEMPLATE');
    assert.equal(mgr.diverged, false);
    assert.equal(mgr.members, 1);
    assert.equal(mgr.scopeKind, 'SUBTREE');
    assert.equal(mgr.editable, true);
    assert.equal(res.data!.find((r) => r.key === 'ACCOUNT_ADMIN')!.editable, false);
    assert.equal(res.data!.find((r) => r.key === 'COLLECTOR')!.scopeKind, 'OWN');
  });

  it('el id de cada fila es el que sirve para invitar o cambiar el rol de una persona', async () => {
    const all = (await call<RoleSummary[]>(acc.A!.admin, 'GET', '/roles?assignable=false')).data!;
    const assignable = (await call<{ id: string; name: string }[]>(acc.A!.admin, 'GET', '/roles')).data!;
    for (const a of assignable) assert.equal(all.find((r) => r.key === a.name)!.id, a.id);
  });

  it('un gerente lee el listado, pero un cobrador no', async () => {
    assert.equal((await call(manager, 'GET', '/roles?assignable=false')).status, 200);
    assert.equal((await call(collector, 'GET', '/roles?assignable=false')).status, 403);
  });

  it('el catálogo trae los permisos con su riesgo, lo reservado y las dependencias', async () => {
    const cat = (await call<PermissionCatalogEntry[]>(acc.A!.admin, 'GET', '/roles/permissions')).data!;
    assert.equal(cat.length, Object.values(Permission).length, 'una fila por permiso del enum');
    // La base (sembrada) coincide con PERMISSION_META: ni riesgo, ni reservado, ni dependencias quedan sin cargar.
    for (const p of cat) {
      const m = PERMISSION_META[p.code as Permission];
      assert.equal(p.risk, m.risk, p.code);
      assert.equal(p.reserved, m.reserved ?? null, p.code);
      assert.deepEqual([...p.requires].sort(), [...(m.requires ?? [])].sort(), p.code);
    }
    assert.equal(cat.find((p) => p.code === 'role:write')!.reserved, 'ADMIN_CORE');
    assert.ok(cat.find((p) => p.code === 'client:write')!.requires.includes('client:read'));
    assert.ok(cat.every((p) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(p.risk)));
  });

  it('el detalle trae permisos, diferencia con la plantilla y personas; un rol que no existe da 404', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/MANAGER')).data!;
    assert.ok(d.granted.includes('client:read'));
    assert.deepEqual(d.diff, { added: [], removed: [] });
    assert.equal(d.people.length, 1);
    const missing = await call(acc.A!.admin, 'GET', '/roles/FANTASMA');
    assert.equal(missing.status, 404);
    assert.equal(missing.error?.code, 'ROLE_NOT_FOUND');
  });

  it('comparar dos roles devuelve una fila por permiso', async () => {
    const c = (await call<RoleCompare>(acc.A!.admin, 'GET', '/roles/compare?a=MANAGER&b=COLLECTOR')).data!;
    assert.equal(c.a.key, 'MANAGER');
    assert.ok(c.rows.some((r) => r.a && !r.b), 'hay permisos sólo del gerente');
    assert.equal((await call(acc.A!.admin, 'GET', '/roles/compare?a=MANAGER')).status, 400);
  });
});

describe('F7 · editar los permisos de un rol', () => {
  let added = '';
  let version = 0;

  it('🔴 el administrador añade un permiso: versión +1, divergencia, personas afectadas y rastro; la OTRA cuenta no cambia', async () => {
    const before = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/COLLECTOR')).data!;
    version = before.version!;
    added = await candidateFor(before);
    const res = await call<RoleUpdateResult>(acc.A!.admin, 'PUT', '/roles/COLLECTOR/permissions', {
      permissions: [...before.granted, added],
      expectedVersion: version,
      reason: 'Necesitan este permiso en campo',
    });
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.equal(res.data!.role.version, version + 1);
    assert.equal(res.data!.role.diverged, true);
    assert.deepEqual(res.data!.role.diff.added, [added]);
    assert.equal(res.data!.affectedMembers, 1);

    const row = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.A!.id, key: 'COLLECTOR' } });
    assert.ok(row.divergedAt, 'diverged_at registrado');
    const other = (await call<RoleDetail>(acc.B!.admin, 'GET', '/roles/COLLECTOR')).data!;
    assert.equal(other.diverged, false, 'la otra cuenta no cambió');
    assert.ok(!other.granted.includes(added));
    assert.equal(other.version, 1);
  });

  it('🔴 la sesión del cobrador se renueva: con su token viejo la siguiente petición pide renovar, y al volver a entrar ya trae el permiso', async () => {
    const stale = await call(collector, 'GET', '/auth/me');
    assert.equal(stale.status, 401);
    assert.equal(stale.error?.code, 'AUTHZ_STALE');
    const fresh = await login(collectorEmail);
    const claims = JSON.parse(Buffer.from(fresh.split('.')[1]!, 'base64url').toString('utf8')) as { permissions: string[] };
    assert.ok(claims.permissions.includes(added));
    collector = fresh;
  });

  it('🔴 el cambio queda en la auditoría de la cuenta, con el motivo y sin datos personales, y en el historial del rol', async () => {
    const role = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.A!.id, key: 'COLLECTOR' } });
    const rows = await prisma.auditLog.findMany({ where: { accountId: acc.A!.id, entity: 'account_role', entityId: role.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.action, 'ROLE_PERMISSIONS_UPDATED');
    assert.deepEqual(rows[0]!.after, { key: 'COLLECTOR', added: [added], removed: [], reason: 'Necesitan este permiso en campo' });

    const hist = (await call<RoleHistoryPage>(acc.A!.admin, 'GET', '/roles/COLLECTOR/history')).data!;
    assert.equal(hist.items.length, 1);
    assert.deepEqual(hist.items[0]!.added, [added]);
    assert.equal(hist.items[0]!.reason, 'Necesitan este permiso en campo');
    assert.ok(hist.items[0]!.actorName);
  });

  it('🔴 edición simultánea: con la versión vieja → 409 ROLE_VERSION_CONFLICT y no se escribe nada', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/COLLECTOR')).data!;
    const res = await call(acc.A!.admin, 'PUT', '/roles/COLLECTOR/permissions', { permissions: d.granted, expectedVersion: version, reason: 'Con versión vieja' });
    assert.equal(res.status, 409);
    assert.equal(res.error?.code, 'ROLE_VERSION_CONFLICT');
  });

  it('🔴 sin motivo → 422 ROLE_REASON_REQUIRED', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/COLLECTOR')).data!;
    const res = await call(acc.A!.admin, 'PUT', '/roles/COLLECTOR/permissions', { permissions: d.granted, expectedVersion: d.version, reason: '  ' });
    assert.equal(res.status, 422);
    assert.equal(res.error?.code, 'ROLE_REASON_REQUIRED');
  });

  it('🔴 un permiso reservado no se añade (403 ROLE_RESERVED) y la respuesta dice cuál', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/MANAGER')).data!;
    const res = await call<unknown>(acc.A!.admin, 'PUT', '/roles/MANAGER/permissions', { permissions: [...d.granted, 'role:write'], expectedVersion: d.version, reason: 'Intento indebido' });
    assert.equal(res.status, 403);
    assert.equal(res.error?.code, 'ROLE_RESERVED');
    assert.deepEqual((res.error?.details as { violations: { code: string; permissions: string[] }[] }).violations[0], { code: 'ROLE_RESERVED', permissions: ['role:write'] });
  });

  it('🔴 el rol de administrador no se edita (403 ROLE_PROTECTED)', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/ACCOUNT_ADMIN')).data!;
    const res = await call(acc.A!.admin, 'PUT', '/roles/ACCOUNT_ADMIN/permissions', { permissions: d.granted.filter((p) => p !== 'client:read'), expectedVersion: d.version, reason: 'Intento indebido' });
    assert.equal(res.status, 403);
    assert.equal(res.error?.code, 'ROLE_PROTECTED');
  });

  it('🔴 una dependencia sin satisfacer → 422 ROLE_DEPENDENCY; dos alcances → 422 ROLE_SCOPE', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/MANAGER')).data!;
    const noRead = await call(acc.A!.admin, 'PUT', '/roles/MANAGER/permissions', { permissions: d.granted.filter((p) => p !== 'client:read'), expectedVersion: d.version, reason: 'Quitar lectura' });
    assert.equal(noRead.status, 422);
    assert.equal(noRead.error?.code, 'ROLE_DEPENDENCY');
    const twoScopes = await call(acc.A!.admin, 'PUT', '/roles/MANAGER/permissions', { permissions: [...d.granted, 'data:scope:all'], expectedVersion: d.version, reason: 'Dos alcances' });
    assert.equal(twoScopes.status, 422);
    assert.equal(twoScopes.error?.code, 'ROLE_SCOPE');
  });

  it('🔴 un gerente (tiene role:read, no role:write) lee pero no escribe', async () => {
    const d = (await call<RoleDetail>(manager, 'GET', '/roles/COLLECTOR')).data!;
    const res = await call(manager, 'PUT', '/roles/COLLECTOR/permissions', { permissions: d.granted, expectedVersion: d.version, reason: 'Sin permiso' });
    assert.equal(res.status, 403);
  });

  it('el cuerpo mal formado se rechaza (400)', async () => {
    assert.equal((await call(acc.A!.admin, 'PUT', '/roles/COLLECTOR/permissions', { permissions: 'client:read', expectedVersion: 1, reason: 'Mal formado' })).status, 400);
  });
});

describe('F7 · restaurar la plantilla y el historial', () => {
  it('🔴 restaurar devuelve el rol a su plantilla, limpia la divergencia y deja su rastro; el historial pagina por cursor', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/COLLECTOR')).data!;
    assert.equal(d.diverged, true);
    const res = await call<RoleUpdateResult>(acc.A!.admin, 'POST', '/roles/COLLECTOR/restore-template', { expectedVersion: d.version, reason: 'Volver a lo estándar' });
    assert.equal(res.status, 200, JSON.stringify(res.error));
    assert.equal(res.data!.role.diverged, false);
    assert.deepEqual(res.data!.role.diff, { added: [], removed: [] });
    const row = await prisma.accountRole.findFirstOrThrow({ where: { accountId: acc.A!.id, key: 'COLLECTOR' } });
    assert.equal(row.divergedAt, null, 'sin divergencia: el rollout de plataforma vuelve a poder actualizarlo');

    const p1 = (await call<RoleHistoryPage>(acc.A!.admin, 'GET', '/roles/COLLECTOR/history?limit=1')).data!;
    assert.equal(p1.items.length, 1);
    assert.equal(p1.items[0]!.action, 'ROLE_RESTORED_TEMPLATE');
    assert.ok(p1.nextCursor);
    const p2 = (await call<RoleHistoryPage>(acc.A!.admin, 'GET', `/roles/COLLECTOR/history?limit=1&cursor=${encodeURIComponent(p1.nextCursor!)}`)).data!;
    assert.equal(p2.items[0]!.action, 'ROLE_PERMISSIONS_UPDATED');
    assert.equal(p2.nextCursor, null);
  });

  it('un cursor de historial mal formado se rechaza con 400 (no repite la primera página)', async () => {
    const res = await call(acc.A!.admin, 'GET', '/roles/COLLECTOR/history?cursor=basura');
    assert.equal(res.status, 400);
    assert.equal(res.error?.code, 'ROLE_HISTORY_CURSOR_INVALID');
  });

  it('restaurar exige motivo y versión como cualquier cambio', async () => {
    const d = (await call<RoleDetail>(acc.A!.admin, 'GET', '/roles/COLLECTOR')).data!;
    assert.equal((await call(acc.A!.admin, 'POST', '/roles/COLLECTOR/restore-template', { expectedVersion: d.version, reason: '' })).status, 422);
    assert.equal((await call(acc.A!.admin, 'POST', '/roles/COLLECTOR/restore-template', { expectedVersion: 1, reason: 'Con versión vieja' })).status, 409);
  });
});
