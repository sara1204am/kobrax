import { describe, it, expect } from 'vitest';
import { Permission, ROLE_PERMISSIONS, RoleType, emptyWorkspace, type Workspace } from '@kobrax/shared';
import { NAV, crumbsFor, visibleNav } from './nav';

const labels = (permissions: string[]) => visibleNav(permissions).map((i) => i.label);

describe('visibleNav', () => {
  it('F4/08 · Mora es la clave `mora` y pide collection:read', () => {
    const mora = NAV.find((i) => i.label === 'mora');
    expect(mora).toMatchObject({ href: '/mora', permission: Permission.COLLECTION_READ });
    expect(labels(['collection:read'])).toContain('mora');
  });

  it('un cobrador no ve equipo ni cuenta — ni siquiera apagados', () => {
    const collector = ROLE_PERMISSIONS[RoleType.COLLECTOR];
    expect(labels(collector)).not.toContain('team');
    expect(labels(collector)).not.toContain('account');
    // Lo suyo sí: cartera, casos, agenda, rutas, pagos.
    expect(labels(collector)).toEqual(
      expect.arrayContaining(['portfolio', 'mora', 'agenda', 'routes', 'payments']),
    );
  });

  it('el admin de la cuenta ve el menú completo, salvo los ítems ocultos', () => {
    expect(labels(ROLE_PERMISSIONS[RoleType.ACCOUNT_ADMIN])).toEqual(
      NAV.filter((i) => !i.hidden).map((i) => i.label),
    );
  });

  it('sin ningún permiso quedan sólo los ítems que no piden ninguno', () => {
    expect(labels([])).toEqual(['home', 'profile']);
  });

  it('un permiso de más no cuela un ítem que no existe en el menú', () => {
    expect(labels([Permission.CATALOG_READ])).toEqual(['home', 'profile']);
  });

  it('security queda oculto del sidebar: vive dentro de Mi perfil', () => {
    expect(labels(ROLE_PERMISSIONS[RoleType.ACCOUNT_ADMIN])).not.toContain('security');
  });
});

describe('F14 · F6 · secciones del menú por plantilla de rol (ADR-F14-09)', () => {
  const sees = (role: RoleType) => labels(ROLE_PERMISSIONS[role]);

  it('cada sección nueva pide SU permiso y ninguna depende de account:read', () => {
    expect(NAV.find((i) => i.label === 'organization')).toMatchObject({ href: '/organizacion', permission: Permission.OFFICE_READ });
    expect(NAV.find((i) => i.label === 'activity')).toMatchObject({ href: '/actividad', permission: Permission.AUDIT_READ });
    expect(NAV.find((i) => i.label === 'team')).toMatchObject({ permission: Permission.USER_READ });
    const kids = (p: string[]) => visibleNav(p).find((i) => i.label === 'accessSecurity')?.children?.map((c) => c.label);
    expect(kids([Permission.ROLE_READ])).toEqual(['roles']);
    expect(kids([Permission.SUPPORT_CONSENT])).toEqual(['supportAccess']);
    expect(kids([Permission.ROLE_READ, Permission.SUPPORT_CONSENT])).toEqual(['roles', 'supportAccess']);
    expect(NAV.find((i) => i.label === 'accessSecurity')?.anyOf).toEqual([Permission.ROLE_READ, Permission.USER_SESSIONS_REVOKE, Permission.SUPPORT_CONSENT]);
  });

  it('Seguridad aparece con cualquiera de sus permisos, y con ninguno no', () => {
    expect(labels([Permission.SUPPORT_CONSENT])).toContain('accessSecurity');
    expect(labels([Permission.ROLE_READ])).toContain('accessSecurity');
    // Sola, no abre ninguna pantalla: un grupo sin hijos no se dibuja.
    expect(labels([Permission.USER_SESSIONS_REVOKE])).not.toContain('accessSecurity');
    expect(labels([Permission.CLIENT_READ])).not.toContain('accessSecurity');
  });

  it('R-10 · el supervisor ve Organización y Equipo, aunque no tenga account:read', () => {
    expect(sees(RoleType.SUPERVISOR)).toEqual(expect.arrayContaining(['organization', 'team']));
    expect(sees(RoleType.SUPERVISOR)).not.toContain('account');
  });

  it('R-10 · el auditor ve Actividad, aunque no tenga account:read', () => {
    expect(sees(RoleType.AUDITOR)).toContain('activity');
    expect(sees(RoleType.AUDITOR)).not.toContain('account');
  });

  it('el cobrador y la consulta no ven Organización, Equipo, Seguridad, Actividad ni Cuenta', () => {
    for (const role of [RoleType.COLLECTOR, RoleType.VIEWER]) {
      for (const hidden of ['organization', 'team', 'accessSecurity', 'activity', 'account']) expect(sees(role)).not.toContain(hidden);
    }
  });

  it('el administrador ve todas las secciones', () => {
    expect(sees(RoleType.ACCOUNT_ADMIN)).toEqual(expect.arrayContaining(['organization', 'team', 'accessSecurity', 'activity', 'account']));
  });

  it('las migas de las pantallas movidas salen de su sección nueva', () => {
    expect(crumbsFor('/organizacion/papelera')).toEqual([
      { label: 'nav.organization', href: '/organizacion' },
      { label: 'crumbs.papelera', href: undefined },
    ]);
    expect(crumbsFor('/seguridad/soporte')).toEqual([
      { label: 'nav.accessSecurity', href: undefined },
      { label: 'crumbs.soporte', href: undefined },
    ]);
    // La clave de un rol viaja como dato (`roleKey`): la barra superior pone su nombre traducido.
    expect(crumbsFor('/seguridad/roles/ACCOUNT_ADMIN/editar')).toEqual([
      { label: 'nav.accessSecurity', href: undefined },
      { label: 'crumbs.roles', href: '/seguridad/roles' },
      { label: 'crumbs.role', roleKey: 'ACCOUNT_ADMIN', href: '/seguridad/roles/ACCOUNT_ADMIN' },
      { label: 'crumbs.editar', href: undefined },
    ]);
    expect(crumbsFor('/seguridad/roles/comparar')).toEqual([
      { label: 'nav.accessSecurity', href: undefined },
      { label: 'crumbs.roles', href: '/seguridad/roles' },
      { label: 'crumbs.comparar', href: undefined },
    ]);
    expect(crumbsFor('/actividad')).toEqual([{ label: 'nav.activity', href: undefined }]);
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

  it('un id no se dibuja como miga: no hay clave que lo traduzca', () => {
    // `crumbs.<uuid>` no existe en ningún idioma, así que la miga terminaba mostrando la ruta
    // cruda de la clave en la topbar.
    const id = '3f2b9c10-1a4d-4b7e-9c8f-0a1b2c3d4e5f';
    // La sección sigue siendo enlace: en una ficha es el único camino de vuelta a la lista para
    // quien llegó por un link compartido.
    expect(crumbsFor(`/cartera/${id}`)).toEqual([{ label: 'nav.portfolio', href: '/cartera' }]);
    expect(crumbsFor(`/cartera/${id}/bitacora`)).toEqual([
      { label: 'nav.portfolio', href: '/cartera' },
      { label: 'crumbs.bitacora', href: undefined },
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

describe('visibleNav · espacio de trabajo (F15 · P2)', () => {
  const admin = ROLE_PERMISSIONS[RoleType.ACCOUNT_ADMIN];
  const ws = (hiddenModules: Workspace['hiddenModules']): Workspace => ({ ...emptyWorkspace(), hiddenModules });
  const labelsWs = (permissions: string[], w?: Workspace | null) => visibleNav(permissions, w).map((i) => i.label);

  it('🔴 A-1: sin workspace (o «Completo») el menú es idéntico al de hoy', () => {
    expect(labelsWs(admin, undefined)).toEqual(labels(admin));
    expect(labelsWs(admin, null)).toEqual(labels(admin));
    expect(labelsWs(admin, emptyWorkspace())).toEqual(labels(admin));
  });

  it('lo que la organización ocultó sale del menú, en el orden de siempre', () => {
    const lean = labelsWs(admin, ws(['routes', 'team', 'organization', 'import', 'export', 'activity']));
    expect(lean).toEqual(['home', 'portfolio', 'mora', 'agenda', 'payments', 'accessSecurity', 'account', 'profile']);
  });

  it('🔴 A-2: el workspace solo QUITA: para quien no tiene el permiso, ocultar no hace aparecer nada', () => {
    const collector = ROLE_PERMISSIONS[RoleType.COLLECTOR];
    const base = labels(collector);
    for (const hidden of [[], ['routes'], ['routes', 'team', 'export']] as Workspace['hiddenModules'][]) {
      for (const l of labelsWs(collector, ws(hidden))) expect(base).toContain(l);
    }
  });

  it('D-5 / D-8: un troncal escrito a mano en la base (Cartera, Seguridad…) nunca se oculta', () => {
    const w = { ...emptyWorkspace(), hiddenModules: ['portfolio', 'accessSecurity', 'mora'] as never };
    const shown = labelsWs(admin, w);
    for (const core of ['portfolio', 'accessSecurity', 'mora']) expect(shown).toContain(core);
  });

  it('el ítem de Seguridad conserva sus hijos al ocultar otros módulos', () => {
    const security = visibleNav(admin, ws(['routes'])).find((i) => i.label === 'accessSecurity');
    expect(security?.children?.length).toBeGreaterThan(0);
  });
});
