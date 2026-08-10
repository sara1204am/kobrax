import { describe, it, expect } from 'vitest';
import { Permission, ROLE_PERMISSIONS, RoleType } from '@kobrax/shared';
import { NAV, crumbsFor, visibleNav } from './nav';

const labels = (permissions: string[]) => visibleNav(permissions).map((i) => i.label);

describe('visibleNav', () => {
  it('un cobrador no ve equipo ni cuenta — ni siquiera apagados', () => {
    const collector = ROLE_PERMISSIONS[RoleType.COLLECTOR];
    expect(labels(collector)).not.toContain('team');
    expect(labels(collector)).not.toContain('account');
    // Lo suyo sí: cartera, casos, agenda, rutas, pagos.
    expect(labels(collector)).toEqual(
      expect.arrayContaining(['portfolio', 'cases', 'agenda', 'routes', 'payments']),
    );
  });

  it('el admin de la cuenta ve el menú completo', () => {
    expect(labels(ROLE_PERMISSIONS[RoleType.ACCOUNT_ADMIN])).toEqual(NAV.map((i) => i.label));
  });

  it('sin ningún permiso quedan sólo los ítems que no piden ninguno', () => {
    expect(labels([])).toEqual(['home', 'profile', 'security']);
  });

  it('un permiso de más no cuela un ítem que no existe en el menú', () => {
    expect(labels([Permission.AUDIT_READ])).toEqual(['home', 'profile', 'security']);
  });
});

describe('crumbsFor', () => {
  it('en una pantalla raíz devuelve una sola miga, sin enlace', () => {
    expect(crumbsFor('/dashboard')).toEqual([{ label: 'nav.home', href: undefined }]);
  });

  it('en una subpantalla la sección es enlace y la hoja no', () => {
    expect(crumbsFor('/settings/security/password')).toEqual([
      { label: 'nav.security', href: '/settings/security' },
      { label: 'crumbs.password', href: undefined },
    ]);
  });

  it('una ruta que ningún ítem cubre no inventa migas', () => {
    expect(crumbsFor('/otra-cosa')).toEqual([]);
  });

  it('no confunde un prefijo parcial con la sección', () => {
    // `/dashboard-viejo` empieza igual que `/dashboard` pero no cuelga de él.
    expect(crumbsFor('/dashboard-viejo')).toEqual([]);
  });
});
