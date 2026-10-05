import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Permission, ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';

/**
 * F4/08 · D8: el alcance de los roles. Un mismo dato vive en cuatro lugares (presets de shared, catálogo del seed,
 * migración y script de verificación) y se separan en silencio; este spec los ata. No necesita base de datos.
 */
const DB = join(__dirname, '..', '..', '..', '..', '..', 'packages', 'database', 'prisma');
const read = (rel: string) => readFileSync(join(DB, rel), 'utf8');
const MIGRATION = read('migrations/20261004010000_alcance_supervisor_agencia/migration.sql');
const VERIFY = read('verify/alcance-supervisor-agencia.sql');
const SEED = read('seed.ts');

const has = (role: RoleType, p: Permission) => ROLE_PERMISSIONS[role].includes(p);

describe('presets de alcance (shared)', () => {
  it('supervisor: su agencia, y ya NO toda la empresa', () => {
    assert.equal(has(RoleType.SUPERVISOR, Permission.DATA_SCOPE_BRANCH), true);
    assert.equal(has(RoleType.SUPERVISOR, Permission.DATA_SCOPE_ALL), false);
  });

  it('gerente, administradores, auditor y lector ven todo; ninguno es sólo de agencia', () => {
    for (const r of [RoleType.MANAGER, RoleType.ACCOUNT_ADMIN, RoleType.SUPER_ADMIN, RoleType.AUDITOR, RoleType.VIEWER]) {
      assert.equal(has(r, Permission.DATA_SCOPE_ALL), true, r);
    }
    for (const r of [RoleType.MANAGER, RoleType.AUDITOR, RoleType.VIEWER]) assert.equal(has(r, Permission.DATA_SCOPE_BRANCH), false, r);
  });

  it('cobrador: ningún permiso de alcance (sólo lo suyo)', () => {
    assert.equal(has(RoleType.COLLECTOR, Permission.DATA_SCOPE_ALL), false);
    assert.equal(has(RoleType.COLLECTOR, Permission.DATA_SCOPE_BRANCH), false);
  });
});

describe('migración 20261004010000_alcance_supervisor_agencia', () => {
  it('crea el permiso data:scope:branch con alcance BRANCH, idempotente', () => {
    assert.match(MIGRATION, /INSERT INTO "permissions"[\s\S]*'data:scope:branch'[\s\S]*'BRANCH'/);
    assert.match(MIGRATION, /ON CONFLICT \("code"\) DO NOTHING/);
  });

  it('se lo da SÓLO al SUPERVISOR y lo hace idempotente', () => {
    assert.match(MIGRATION, /p\."code" = 'data:scope:branch'\s+WHERE r\."name" = 'SUPERVISOR'\s+ON CONFLICT \("role_id", "permission_id"\) DO NOTHING/);
  });

  it('le quita data:scope:all al SUPERVISOR y a nadie más', () => {
    const del = MIGRATION.slice(MIGRATION.indexOf('DELETE FROM "role_permissions"'));
    assert.match(del, /r\."name" = 'SUPERVISOR' AND p\."code" = 'data:scope:all'/);
    assert.doesNotMatch(del, /'MANAGER'|'COLLECTOR'|'ACCOUNT_ADMIN'|'AUDITOR'|'VIEWER'/);
  });

  it('no toca user_permission_overrides (un alcance total concedido a mano sigue mandando)', () => {
    assert.doesNotMatch(MIGRATION.replace(/--.*$/gm, ''), /user_permission_overrides/);
  });

  it('no cambia el schema', () => {
    assert.doesNotMatch(MIGRATION, /\b(CREATE|ALTER|DROP)\s+(TABLE|TYPE|INDEX|COLUMN)\b/i);
  });
});

describe('seed y verificación', () => {
  it('el catálogo del seed declara el permiso nuevo con alcance BRANCH (si no, el seed lo ignora en silencio)', () => {
    assert.match(SEED, /\['data:scope:branch', 'data', 'READ', 'BRANCH'\]/);
  });

  it('el seed SINCRONIZA el alcance: quita el que el rol ya no lleva', () => {
    assert.match(SEED, /staleScopes/);
    assert.match(SEED, /\['data:scope:all', 'data:scope:branch'\]\.filter\(\(c\) => !codes\.includes\(c\)\)/);
  });

  it('el script de verificación comprueba supervisor = branch (no all), gerencia = all, cobrador = ninguno', () => {
    assert.match(VERIFY, /el SUPERVISOR sigue con data:scope:all/);
    assert.match(VERIFY, /el SUPERVISOR no tiene data:scope:branch/);
    assert.match(VERIFY, /sin data:scope:all/);
    assert.match(VERIFY, /COLLECTOR tiene un alcance mayor al propio/);
    assert.match(VERIFY, /ON_ERROR_STOP=1/);
  });
});
