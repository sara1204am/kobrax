import { ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { TAB_PERMISSION, tabAllowed } from './tabs';
import { setSessionNotice, takeSessionNotice } from './session-notice';

describe('tabAllowed · tabs por permiso (F14 · F8, D-9)', () => {
  it('Inicio y Más los ve cualquiera con sesión', () => {
    expect(tabAllowed('index', [])).toBe(true);
    expect(tabAllowed('mas', [])).toBe(true);
  });

  it('Agenda, Rutas y Cobranza piden su permiso de lectura', () => {
    expect(TAB_PERMISSION).toMatchObject({ agenda: 'agenda:read', rutas: 'route:read', cobranza: 'collection:read' });
    expect(tabAllowed('agenda', ['route:read'])).toBe(false);
    expect(tabAllowed('rutas', ['route:read'])).toBe(true);
    expect(tabAllowed('cobranza', ['agenda:read', 'route:read'])).toBe(false);
  });

  it('🔴 los cuatro roles de campo siguen viendo los cinco tabs (nada cambia para ellos)', () => {
    for (const role of [RoleType.ACCOUNT_ADMIN, RoleType.MANAGER, RoleType.SUPERVISOR, RoleType.COLLECTOR]) {
      for (const tab of Object.keys(TAB_PERMISSION) as (keyof typeof TAB_PERMISSION)[]) {
        if (!tabAllowed(tab, ROLE_PERMISSIONS[role])) throw new Error(`${role} perdería el tab ${tab}`);
      }
    }
  });

  it('sin permisos conocidos (no se leyó `me`) se ofrecen todos', () => {
    expect(tabAllowed('agenda', null)).toBe(true);
    expect(tabAllowed('cobranza', undefined)).toBe(true);
  });
});

describe('aviso de fin de sesión (F14 · F8, D-3)', () => {
  it('se entrega una sola vez', () => {
    setSessionNotice('Tu rol se usa desde la web.');
    expect(takeSessionNotice()).toBe('Tu rol se usa desde la web.');
    expect(takeSessionNotice()).toBeNull();
  });
});
