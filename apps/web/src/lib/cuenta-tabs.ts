import { Permission } from '@kobrax/shared';

/**
 * Las pestañas de `/cuenta`. `key` es la clave dentro de `account.tabs` en i18n y también el
 * último tramo de la ruta (`/cuenta/<key>`), igual que `NAV` con `panel.nav`.
 */
export type CuentaTabKey =
  | 'general'
  | 'plan'
  | 'cobranza'
  | 'mensajes'
  | 'catalogos'
  | 'facturacion'
  | 'espacio-de-trabajo'
  | 'avanzado';

export interface CuentaTab {
  key: CuentaTabKey;
  href: string;
  /** Permiso necesario para abrirla. */
  permission: Permission;
}

export const CUENTA_TABS: CuentaTab[] = [
  { key: 'general', href: '/cuenta/general', permission: Permission.ACCOUNT_READ },
  { key: 'plan', href: '/cuenta/plan', permission: Permission.ACCOUNT_READ },
  { key: 'cobranza', href: '/cuenta/cobranza', permission: Permission.ACCOUNT_READ },
  { key: 'mensajes', href: '/cuenta/mensajes', permission: Permission.CATALOG_READ },
  { key: 'catalogos', href: '/cuenta/catalogos', permission: Permission.CATALOG_READ },
  { key: 'facturacion', href: '/cuenta/facturacion', permission: Permission.ACCOUNT_READ },
  // F15 · P4: qué ve esta organización. Solo quien puede editar la cuenta.
  {
    key: 'espacio-de-trabajo',
    href: '/cuenta/espacio-de-trabajo',
    permission: Permission.ACCOUNT_WRITE,
  },
  { key: 'avanzado', href: '/cuenta/avanzado', permission: Permission.ACCOUNT_WRITE },
];

/**
 * Las pestañas que esta persona puede abrir. Sin permiso no se dibuja, ni en gris.
 *
 * 🔴 Cosmética: la API valida siempre.
 */
export function visibleCuentaTabs(permissions: string[]): CuentaTab[] {
  const granted = new Set(permissions);
  return CUENTA_TABS.filter((tab) => granted.has(tab.permission));
}
