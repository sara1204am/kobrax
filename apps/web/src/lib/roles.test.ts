import { describe, it, expect } from 'vitest';
import { Permission, PERMISSION_META, type PermissionCatalogEntry } from '@kobrax/shared';
import { dependentsOf, groupByModule, permissionKey, scopeOf, setScope, summarizeChange, togglePermission } from './roles';

const catalog: PermissionCatalogEntry[] = Object.values(Permission).map((code) => ({
  code,
  module: code.split(':')[0]!,
  action: 'x',
  risk: PERMISSION_META[code].risk,
  reserved: PERMISSION_META[code].reserved ?? null,
  requires: [...(PERMISSION_META[code].requires ?? [])],
  name: code,
  description: null,
}));

describe('lib/roles · el editor de roles (F14 · F7)', () => {
  it('agrupa por módulo en el orden del editor y deja los alcances de datos fuera', () => {
    const groups = groupByModule(catalog);
    expect(groups[0]!.module).toBe('client');
    expect(groups.map((g) => g.module)).not.toContain('data');
    expect(groups.flatMap((g) => g.items).some((p) => p.code.startsWith('data:scope:'))).toBe(false);
    expect(groups.flatMap((g) => g.items).length).toBe(catalog.length - 3);
  });

  it('la clave de i18n de un permiso no lleva dos puntos', () => {
    expect(permissionKey('client:import:replace')).toBe('client_import_replace');
  });

  it('encender un permiso marca sus dependencias, también las encadenadas, y lo dice', () => {
    const r = togglePermission(['data:scope:subtree'], 'client:import:replace', true, catalog);
    expect(r.next).toEqual(expect.arrayContaining(['client:read', 'client:import', 'client:import:replace']));
    expect(r.autoAdded.sort()).toEqual(['client:import', 'client:read']);
  });

  it('apagar un permiso apaga lo que dependía de él, y lo dice', () => {
    const r = togglePermission(['client:read', 'client:write', 'client:delete', 'report:read'], 'client:read', false, catalog);
    expect(r.next).toEqual(['report:read']);
    expect(r.autoRemoved).toEqual(['client:delete', 'client:write']);
  });

  it('dependentsOf sólo mira lo concedido', () => {
    expect(dependentsOf('client:read', ['client:read', 'client:write'], catalog)).toEqual(['client:write']);
    expect(dependentsOf('client:read', ['client:read'], catalog)).toEqual([]);
  });

  it('el alcance de datos es uno solo: cambiar quita el anterior; null deja el alcance propio', () => {
    expect(scopeOf(['client:read', 'data:scope:branch'])).toBe('data:scope:branch');
    expect(setScope(['client:read', 'data:scope:branch'], 'data:scope:all')).toEqual(['client:read', 'data:scope:all']);
    expect(setScope(['client:read', 'data:scope:branch'], null)).toEqual(['client:read']);
    expect(scopeOf(['client:read'])).toBeNull();
  });

  it('el resumen cuenta lo añadido y lo quitado y destaca el riesgo alto añadido', () => {
    const s = summarizeChange(['client:read', 'report:read'], ['client:read', 'client:delete', 'client:write'], catalog);
    expect(s.added).toEqual(['client:delete', 'client:write']);
    expect(s.removed).toEqual(['report:read']);
    expect(s.highRiskAdded).toEqual(['client:delete']);
    expect(s.count).toBe(3);
    expect(summarizeChange(['a'], ['a'], catalog).count).toBe(0);
  });
});
