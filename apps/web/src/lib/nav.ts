import { Permission, emptyWorkspace, resolveWorkspace, type Workspace, type WorkspaceNavKey } from '@kobrax/shared';
import { isUuid } from './uuid';

/**
 * Un ítem del menú lateral.
 *
 * `label` es la clave dentro del namespace `panel.nav` de i18n, no el texto: el panel es
 * bilingüe y un rótulo hardcodeado acá saldría en español en la versión en inglés.
 */
export type NavKey =
  | 'home'
  | 'portfolio'
  | 'import'
  | 'mora'
  | 'agenda'
  | 'routes'
  | 'payments'
  | 'team'
  | 'account'
  | 'export'
  | 'organization'
  | 'activity'
  | 'accessSecurity'
  | 'profile'
  | 'security';

/** Hijos del menú (clave en `panel.nav`). Sin ícono: cuelgan de su padre. */
export type NavChildKey = 'roles' | 'supportAccess';

export interface NavChild {
  label: NavChildKey;
  href: string;
  permission: Permission;
}

export interface NavItem {
  label: NavKey;
  /** Subpantallas que se despliegan bajo el ítem cuando estás dentro de su sección (cada una con su permiso). */
  children?: NavChild[];
  href: string;
  /** Permiso necesario para verlo. `null` = lo ve cualquiera con sesión (salvo que tenga `anyOf`). */
  permission: Permission | null;
  /** F14 · F6: «cualquiera de» estos permisos (la sección Seguridad). Si está, manda sobre `permission`. */
  anyOf?: readonly Permission[];
  /** `false` mientras el módulo no exista: se pinta en gris y **no navega**. */
  built: boolean;
  /**
   * No se dibuja en el sidebar, pero sigue contando para las migas de pan (`crumbsFor`).
   * Es el caso de `security`: ahora vive dentro de Mi perfil como su sección de Seguridad,
   * así que como ítem propio del menú sobra — pero `/settings/security/sessions` sigue
   * necesitando una miga que lo lleve de vuelta al hub.
   */
  hidden?: boolean;
}

/**
 * El menú del panel, en orden.
 *
 * Los `built: false` son los módulos que todavía no existen (W2–W7). Se muestran apagados
 * por decisión de la dueña (2026-08-10): el sidebar hace de mapa del producto para un equipo
 * que ya sabe que se está construyendo. Es una excepción acotada a «no pintar lo que no
 * existe» — no son enlaces, no prometen fecha, y encenderlos es cambiar este `false`.
 */
export const NAV: NavItem[] = [
  { label: 'home', href: '/dashboard', permission: null, built: true },
  { label: 'portfolio', href: '/cartera', permission: Permission.CLIENT_READ, built: true },
  { label: 'import', href: '/import', permission: Permission.CLIENT_IMPORT, built: true },
  { label: 'mora', href: '/mora', permission: Permission.COLLECTION_READ, built: true },
  { label: 'agenda', href: '/agenda', permission: Permission.AGENDA_READ, built: true },
  { label: 'routes', href: '/rutas', permission: Permission.ROUTE_READ, built: true },
  { label: 'payments', href: '/pagos', permission: Permission.PAYMENT_READ, built: true },
  { label: 'export', href: '/exportar', permission: Permission.REPORT_EXPORT, built: true },
  // F14 · F6 (ADR-F14-09): cada sección pide SU permiso; ninguna depende de `account:read` salvo Cuenta.
  { label: 'organization', href: '/organizacion', permission: Permission.OFFICE_READ, built: true },
  { label: 'team', href: '/equipo', permission: Permission.USER_READ, built: true },
  {
    label: 'accessSecurity',
    href: '/seguridad',
    permission: null,
    anyOf: [Permission.ROLE_READ, Permission.USER_SESSIONS_REVOKE, Permission.SUPPORT_CONSENT],
    built: true,
    // Las mismas dos tarjetas del índice de /seguridad, como hijos del menú.
    children: [
      { label: 'roles', href: '/seguridad/roles', permission: Permission.ROLE_READ },
      { label: 'supportAccess', href: '/seguridad/soporte', permission: Permission.SUPPORT_CONSENT },
    ],
  },
  { label: 'activity', href: '/actividad', permission: Permission.AUDIT_READ, built: true },
  { label: 'account', href: '/cuenta', permission: Permission.ACCOUNT_READ, built: true },
  { label: 'profile', href: '/settings/perfil', permission: null, built: true },
  { label: 'security', href: '/settings/security', permission: null, built: true, hidden: true },
];

/**
 * Los ítems que esta persona puede ver.
 *
 * **Sin permiso no se dibuja, ni en gris.** Los dos filtros del menú no son el mismo: que un
 * módulo esté apagado cuenta algo sobre el producto; que aparezca uno que nunca vas a poder
 * abrir cuenta algo sobre *tu* cuenta, y eso no se muestra.
 *
 * 🔴 Esto es cosmética. La API valida siempre: ocultar no es autorizar.
 */
function canSee(item: NavItem, granted: ReadonlySet<string>): boolean {
  if (item.anyOf) return item.anyOf.some((p) => granted.has(p));
  return item.permission === null || granted.has(item.permission);
}

export function visibleNav(permissions: string[], workspace?: Workspace | null): NavItem[] {
  const granted = new Set(permissions);
  // F15: lo que la organización ocultó sale del menú. Solo QUITA (R1): nunca aparece algo que el permiso no daba. Un ítem sin
  // entrada en el catálogo (p. ej. el de seguridad de la sesión) o troncal siempre se muestra.
  const shown = resolveWorkspace(workspace ?? emptyWorkspace());
  return NAV.filter((item) => !item.hidden && canSee(item, granted) && shown.showsModule(item.label as WorkspaceNavKey))
    .map((item) => (item.children ? { ...item, children: item.children.filter((c) => granted.has(c.permission)) } : item))
    // Un grupo sin ningún hijo visible no lleva a ningún lado: no se dibuja.
    .filter((item) => !item.children || item.children.length > 0);
}

/**
 * Una miga del rastro de navegación. Sin `href` = la hoja actual, que no es enlace.
 * `label` es la clave **relativa al namespace `panel`** (`nav.home`, `crumbs.password`).
 */
export interface Crumb {
  label: string;
  /** La clave de un rol (`ACCOUNT_ADMIN`): es un dato; la pantalla lo traduce con `permissions.roleNames`. */
  roleKey?: string;
  href?: string;
}


/**
 * Rastro de navegación para una ruta.
 *
 * La primera miga sale del ítem del menú que cubre la ruta; lo que sobra se agrega como migas
 * sueltas, con su clave en `panel.crumbs`.
 *
 * ponytail: `find` y no «el prefijo más largo» porque hoy ningún ítem del `NAV` es prefijo de
 * otro. El día que existan `/cuenta` y `/cuenta/facturacion`, gana el que esté primero en el
 * `NAV` — y ahí se ordena por largo.
 */
export function crumbsFor(pathname: string): Crumb[] {
  const match = NAV.find((i) => i.built && (pathname === i.href || pathname.startsWith(`${i.href}/`)));
  if (!match) return [];

  const segments = pathname.slice(match.href.length).split('/').filter(Boolean);
  // Un id no es una clave de i18n: `crumbs.<uuid>` no existe en ningún idioma y la miga terminaba
  // dibujando la ruta cruda de la clave. Se cae la miga, no el rastro: `/cartera/<id>` sigue
  // diciendo «Cartera», y `/cartera/<id>/bitacora`, «Cartera / Bitácora».
  // La clave de un rol (`/seguridad/roles/ACCOUNT_ADMIN`) tampoco es una clave de i18n: se queda como miga
  // con `roleKey`, y la barra superior pone el nombre traducido del rol.
  const isRoleKey = (segment: string, i: number) =>
    segments[i - 1] === 'roles' && match.href === '/seguridad' && segment !== 'comparar';
  const rest = segments.map((segment, i) => ({ segment, i })).filter(({ segment }) => !isUuid(segment));

  return [
    {
      label: `nav.${match.label}`,
      /*
       * La sección es enlace si la ruta baja de ella, **aunque lo que baje sea sólo un id**: en
       * un detalle es el único camino de vuelta a la lista para quien llegó por un link. Mirar
       * `rest` en vez de `segments` dejaba la miga como texto plano en toda ficha.
       */
      // Un grupo (Seguridad) no tiene pantalla propia: su miga es texto, no enlace.
      href: segments.length > 0 && !match.children ? match.href : undefined,
    },
    ...rest.map(({ segment, i: at }, i) => ({
      label: isRoleKey(segment, at) ? 'crumbs.role' : `crumbs.${segment}`,
      ...(isRoleKey(segment, at) ? { roleKey: decodeURIComponent(segment) } : {}),
      href: i < rest.length - 1 ? `${match.href}/${segments.slice(0, at + 1).join('/')}` : undefined,
    })),
  ];
}
