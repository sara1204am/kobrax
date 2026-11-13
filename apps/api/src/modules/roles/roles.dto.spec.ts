import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createValidationPipe } from '../../common/validation/validation-pipe';
import { CompareRolesQuery, ListRolesQuery, RoleHistoryQuery, UpdateRolePermissionsDto } from './dto/roles.dto';

// El mismo pipe que usa la API (`main.ts`): lo que llega de la red pasa por acá.
const pipe = createValidationPipe();
const run = <T>(value: unknown, metatype: new () => T, type: 'query' | 'body' = 'query') => pipe.transform(value, { type, metatype }) as Promise<T>;

describe('DTOs de /roles (F14 · F7)', () => {
  it('GET /roles sin parámetros sigue siendo el listado de asignables (assignable no viene)', async () => {
    assert.equal((await run({}, ListRolesQuery)).assignable, undefined);
  });

  it('`assignable=false` llega como booleano; `true` también; cualquier otra cosa se rechaza', async () => {
    assert.equal((await run({ assignable: 'false' }, ListRolesQuery)).assignable, false);
    assert.equal((await run({ assignable: 'true' }, ListRolesQuery)).assignable, true);
    await assert.rejects(() => run({ assignable: 'quizás' }, ListRolesQuery));
  });

  it('el cuerpo de PUT exige permisos, versión y motivo; rechaza campos de más', async () => {
    const ok = { permissions: ['client:read'], expectedVersion: 2, reason: 'porque sí' };
    assert.deepEqual((await run(ok, UpdateRolePermissionsDto, 'body')).permissions, ['client:read']);
    await assert.rejects(() => run({ ...ok, expectedVersion: 0 }, UpdateRolePermissionsDto, 'body'));
    await assert.rejects(() => run({ ...ok, permissions: 'client:read' }, UpdateRolePermissionsDto, 'body'));
    await assert.rejects(() => run({ ...ok, permissions: [1] }, UpdateRolePermissionsDto, 'body'));
    await assert.rejects(() => run({ ...ok, extra: 1 }, UpdateRolePermissionsDto, 'body'));
    await assert.rejects(() => run({ permissions: [], expectedVersion: 1 }, UpdateRolePermissionsDto, 'body'));
  });

  it('comparar exige las dos claves; el historial acota el tamaño de página', async () => {
    await assert.rejects(() => run({ a: 'MANAGER' }, CompareRolesQuery));
    assert.equal((await run({ a: 'MANAGER', b: 'SUPERVISOR' }, CompareRolesQuery)).b, 'SUPERVISOR');
    assert.equal((await run({ limit: '20' }, RoleHistoryQuery)).limit, 20);
    await assert.rejects(() => run({ limit: '500' }, RoleHistoryQuery));
  });
});
