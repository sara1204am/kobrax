import { Permission } from '@kobrax/shared';

/**
 * Las pestañas de `/cuenta`. `key` es la clave dentro de `account.tabs` en i18n y también el
 * último tramo de la ruta (`/cuenta/<key>`), igual que `NAV` con `panel.nav`.
 */
export type CuentaTabKey = 'general' | 'plan' | 'cobranza' | 'mensajes';

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
