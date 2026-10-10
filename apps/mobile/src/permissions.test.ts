import { Permission } from '@kobrax/shared';
import { can, canAll, canAny } from './permissions';

describe('permisos (solo qué se ofrece; la API autoriza)', () => {
  const perms = [Permission.CLIENT_IMPORT, Permission.COLLECTION_WRITE];

  it('can: con y sin el permiso', () => {
    expect(can(perms, Permission.CLIENT_IMPORT)).toBe(true);
    expect(can(perms, Permission.USER_WRITE)).toBe(false);
  });

  it('lista ausente = nada permitido (no se asume permiso)', () => {
    expect(can(undefined, Permission.CLIENT_IMPORT)).toBe(false);
    expect(can(null, Permission.CLIENT_IMPORT)).toBe(false);
    expect(can([], Permission.CLIENT_IMPORT)).toBe(false);
  });

  it('canAny / canAll', () => {
    expect(canAny(perms, [Permission.USER_WRITE, Permission.COLLECTION_WRITE])).toBe(true);
    expect(canAny(perms, [Permission.USER_WRITE])).toBe(false);
    expect(canAll(perms, [Permission.CLIENT_IMPORT, Permission.COLLECTION_WRITE])).toBe(true);
    expect(canAll(perms, [Permission.CLIENT_IMPORT, Permission.USER_WRITE])).toBe(false);
  });
});
