import { describe, it, expect } from 'vitest';
import { ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { CUENTA_TABS, visibleCuentaTabs } from './cuenta-tabs';

const keys = (permissions: string[]) => visibleCuentaTabs(permissions).map((t) => t.key);

describe('visibleCuentaTabs', () => {
  it('cada pestaña vive en /cuenta/<clave>', () => {
    for (const tab of CUENTA_TABS) expect(tab.href).toBe(`/cuenta/${tab.key}`);
  });

  it('el administrador ve todas', () => {
    expect(keys(ROLE_PERMISSIONS[RoleType.ACCOUNT_ADMIN])).toEqual(['general', 'plan', 'cobranza', 'mensajes']);
  });

  it('sin catalog:read no hay «Mensajes»', () => {
    expect(keys(['account:read'])).toEqual(['general', 'plan', 'cobranza']);
  });

  it('sin account:read no hay ninguna que dependa de la cuenta', () => {
    expect(keys(['catalog:read'])).toEqual(['mensajes']);
    expect(keys([])).toEqual([]);
  });
});
