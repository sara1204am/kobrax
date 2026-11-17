import { describe, it, expect } from 'vitest';
import { ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { CUENTA_TABS, visibleCuentaTabs } from './cuenta-tabs';

const keys = (permissions: string[]) => visibleCuentaTabs(permissions).map((t) => t.key);

describe('visibleCuentaTabs', () => {
  it('cada pestaña vive en /cuenta/<clave>', () => {
    for (const tab of CUENTA_TABS) expect(tab.href).toBe(`/cuenta/${tab.key}`);
  });

  it('el administrador ve todas', () => {
    expect(keys(ROLE_PERMISSIONS[RoleType.ACCOUNT_ADMIN])).toEqual(['general', 'plan', 'cobranza', 'mensajes', 'catalogos', 'facturacion', 'espacio-de-trabajo', 'avanzado']);
  });

  it('sin catalog:read no hay «Mensajes» ni «Catálogos»', () => {
    expect(keys(['account:read'])).toEqual(['general', 'plan', 'cobranza', 'facturacion']);
  });

  it('F14 · F6: Oficinas, Actividad y Accesos de soporte ya no son pestañas de Cuenta (tienen su sección en el menú)', () => {
    const all = CUENTA_TABS.map((t) => t.key as string);
    for (const moved of ['oficinas', 'actividad', 'soporte']) expect(all).not.toContain(moved);
    expect(keys(['office:read', 'audit:read', 'support:consent'])).toEqual([]);
  });

  it('sin account:read no hay ninguna que dependa de la cuenta', () => {
    expect(keys(['catalog:read'])).toEqual(['mensajes', 'catalogos']);
    // F15 · P4: «Espacio de trabajo» y «Avanzado» piden `account:write` (la configuración de la organización).
    expect(keys(['account:write'])).toEqual(['espacio-de-trabajo', 'avanzado']);
    expect(keys([])).toEqual([]);
  });
});
