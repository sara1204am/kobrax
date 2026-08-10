'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

const PermissionsContext = createContext<ReadonlySet<string>>(new Set());

/**
 * Siembra los permisos que el layout del panel ya trajo de `/auth/me`.
 * No pide nada a la API: si lo hiciera, sería la segunda vez en el mismo render.
 */
export function PermissionsProvider({
  permissions,
  children,
}: {
  permissions: string[];
  children: ReactNode;
}) {
  const value = useMemo(() => new Set(permissions), [permissions]);
  return <PermissionsContext.Provider value={value}>{children}</PermissionsContext.Provider>;
}

/**
 * `can('client:read')` para esconder lo que esta persona no puede hacer.
 *
 * 🔴 **Ocultar no es autorizar.** Esto sólo decide qué se dibuja; quien autoriza es la API,
 * que valida el permiso en cada request aunque el botón no exista en la pantalla.
 */
export function usePermissions(): { can: (permission: string) => boolean } {
  const granted = useContext(PermissionsContext);
  return useMemo(() => ({ can: (permission: string) => granted.has(permission) }), [granted]);
}
