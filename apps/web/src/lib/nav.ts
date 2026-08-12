import { Permission } from '@kobrax/shared';

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
  | 'cases'
  | 'agenda'
  | 'routes'
  | 'payments'
  | 'team'
  | 'account'
  | 'profile'
  | 'security';

export interface NavItem {
  label: NavKey;
  href: string;
  /** Permiso necesario para verlo. `null` = lo ve cualquiera con sesión. */
  permission: Permission | null;
  /** `false` mientras el módulo no exista: se pinta en gris y **no navega**. */
  built: boolean;
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
  { label: 'cases', href: '/casos', permission: Permission.CASE_READ, built: true },
  { label: 'agenda', href: '/agenda', permission: Permission.AGENDA_READ, built: true },
  { label: 'routes', href: '/rutas', permission: Permission.ROUTE_READ, built: false },
  { label: 'payments', href: '/pagos', permission: Permission.PAYMENT_READ, built: false },
  { label: 'team', href: '/equipo', permission: Permission.USER_READ, built: true },
  { label: 'account', href: '/cuenta', permission: Permission.ACCOUNT_READ, built: true },
  { label: 'profile', href: '/settings/perfil', permission: null, built: true },
  { label: 'security', href: '/settings/security', permission: null, built: true },
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
export function visibleNav(permissions: string[]): NavItem[] {
  const granted = new Set(permissions);
  return NAV.filter((item) => item.permission === null || granted.has(item.permission));
}

/**
 * Una miga del rastro de navegación. Sin `href` = la hoja actual, que no es enlace.
 * `label` es la clave **relativa al namespace `panel`** (`nav.home`, `crumbs.password`).
 */
export interface Crumb {
  label: string;
  href?: string;
}

/** Un segmento que es un id (uuid), no una sección con nombre traducible. */
const IS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  const rest = pathname
    .slice(match.href.length)
    .split('/')
    .filter(Boolean)
    // Un id no es una clave de i18n: `crumbs.<uuid>` no existe en ningún idioma y la miga
    // terminaba dibujando la ruta cruda de la clave. Se cae la miga, no el rastro: `/cartera/<id>`
    // sigue diciendo «Cartera», y `/cartera/<id>/editar`, «Cartera / Editar».
    .filter((segment) => !IS_ID.test(segment));

  return [
    { label: `nav.${match.label}`, href: rest.length > 0 ? match.href : undefined },
    ...rest.map((segment, i) => ({
      label: `crumbs.${segment}`,
      href: i < rest.length - 1 ? `${match.href}/${rest.slice(0, i + 1).join('/')}` : undefined,
    })),
  ];
}
