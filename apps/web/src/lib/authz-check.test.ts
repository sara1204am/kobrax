import { describe, it, expect } from 'vitest';
import { decideAccess } from './authz-check';

describe('decideAccess · la puerta de una pantalla (F14 · F6)', () => {
  it('un permiso que se tiene abre', () => {
    expect(decideAccess({ status: 200, permissions: ['office:read'] }, 'office:read')).toBe('ok');
  });

  it('un permiso que no se tiene es «sin acceso»', () => {
    expect(decideAccess({ status: 200, permissions: ['client:read'] }, 'office:read')).toBe('denied');
  });

  it('«cualquiera de»: basta uno', () => {
    const need = { anyOf: ['role:read', 'support:consent'] };
    expect(decideAccess({ status: 200, permissions: ['support:consent'] }, need)).toBe('ok');
    expect(decideAccess({ status: 200, permissions: ['client:read'] }, need)).toBe('denied');
  });

  it('401 y 403 son «sin acceso»', () => {
    expect(decideAccess({ status: 401 }, 'office:read')).toBe('denied');
    expect(decideAccess({ status: 403 }, 'office:read')).toBe('denied');
  });

  it('🔴 un fallo de la API (red caída, 5xx) NO se muestra como «sin acceso»: se reintenta', () => {
    expect(decideAccess({ status: 0 }, 'office:read')).toBe('error');
    expect(decideAccess({ status: 500 }, 'office:read')).toBe('error');
    expect(decideAccess({ status: 200 }, 'office:read')).toBe('error');
  });
});
