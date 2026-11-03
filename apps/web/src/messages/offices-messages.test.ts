import { describe, expect, it } from 'vitest';
import es from './es.json';
import en from './en.json';

/** Todas las claves hoja de un objeto, como `a.b.c`. */
function keys(node: unknown, prefix = ''): string[] {
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe('textos de oficinas (F13)', () => {
  it('es y en tienen exactamente las mismas claves', () => {
    expect(keys(en.account.offices).sort()).toEqual(keys(es.account.offices).sort());
  });

  it('la terminología es «oficina» y no quedó el namespace viejo de agencias', () => {
    expect((es.account as Record<string, unknown>).branches).toBeUndefined();
    expect(es.account.tabs.oficinas).toBe('Oficinas');
    expect(en.account.tabs.oficinas).toBe('Offices');
    expect(JSON.stringify(es.account.offices)).not.toMatch(/sucursal/i);
  });
});
