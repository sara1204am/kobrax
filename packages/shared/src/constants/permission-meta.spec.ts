import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Permission } from '../enums/permission.enum.js';
import { RoleType } from '../enums/role.enum.js';
import { checkRoleEdit } from '../utils/role-edit.js';
import { ROLE_PERMISSIONS } from './permissions.js';
import { PERMISSION_META, permissionMetaSql } from './permission-meta.js';

const codes = Object.values(Permission) as string[];
const catalog = codes.map((code) => ({ code, reserved: PERMISSION_META[code as Permission].reserved ?? null, requires: [...(PERMISSION_META[code as Permission].requires ?? [])] as string[] }));

describe('PERMISSION_META — el catálogo que lee el editor de roles (F14 · F7)', () => {
  it('cubre exactamente los permisos del enum', () => {
    expect(Object.keys(PERMISSION_META).sort()).toEqual([...codes].sort());
  });

  it('toda dependencia es un permiso que existe, y nadie depende de sí mismo', () => {
    for (const code of codes) {
      for (const req of PERMISSION_META[code as Permission].requires ?? []) {
        expect(codes, `${code} requiere ${req}`).toContain(req);
        expect(req).not.toBe(code);
      }
    }
  });

  it('no hay ciclos de dependencia', () => {
    const visit = (code: string, seen: string[]): void => {
      expect(seen, `ciclo ${[...seen, code].join(' → ')}`).not.toContain(code);
      for (const req of PERMISSION_META[code as Permission].requires ?? []) visit(req, [...seen, code]);
    };
    for (const code of codes) visit(code, []);
  });

  it('🔴 ninguna plantilla de rol viola las dependencias ni el alcance (si lo hiciera, sus copias no se podrían guardar jamás)', () => {
    for (const role of [RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR, RoleType.AUDITOR, RoleType.VIEWER]) {
      const granted = ROLE_PERMISSIONS[role];
      const violations = checkRoleEdit({ targetKey: role, catalog, current: granted, desired: granted, actorHas: () => true, actorInTargetRole: false });
      expect(violations.map((v) => `${v.code}: ${v.permissions.join(',')}`), role).toEqual([]);
    }
  });

  it('los reservados son exactamente el núcleo del administrador', () => {
    const reserved = codes.filter((c) => PERMISSION_META[c as Permission].reserved).sort();
    expect(reserved).toEqual(['account:write', 'office:write', 'role:write', 'user:write']);
  });

  it('lo destructivo, lo que muestra datos en claro y lo que administra no es de riesgo bajo', () => {
    for (const c of [Permission.CLIENT_DELETE, Permission.CLIENT_PII_READ, Permission.REPORT_EXPORT, Permission.USER_INVITE, Permission.ROLE_WRITE]) {
      expect(PERMISSION_META[c].risk, c).not.toBe('LOW');
    }
  });

  it('🔴 la migración del catálogo coincide con PERMISSION_META (si cambia uno, hay que regenerar la otra)', () => {
    const file = join(__dirname, '../../../database/prisma/migrations/20261108010000_f14_f7_permission_catalog_meta/migration.sql');
    const sql = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    expect(sql.endsWith(permissionMetaSql() + '\n')).toBe(true);
  });
});
