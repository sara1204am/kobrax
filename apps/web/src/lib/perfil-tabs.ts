/**
 * Las pestañas de Mi perfil. `key` es la clave dentro de `profile.tabs` en i18n y también el
 * último tramo de la ruta (`/settings/perfil/<key>`), igual que `CUENTA_TABS`. Todas son de cada
 * quien: ninguna pide permiso.
 */
export type PerfilTabKey = 'datos-personales' | 'preferencias' | 'seguridad';

export const PERFIL_TABS: { key: PerfilTabKey; href: string }[] = [
  { key: 'datos-personales', href: '/settings/perfil/datos-personales' },
  { key: 'preferencias', href: '/settings/perfil/preferencias' },
  { key: 'seguridad', href: '/settings/perfil/seguridad' },
];
