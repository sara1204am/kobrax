import type { ReactNode } from 'react';

/**
 * Ajustes no fija ancho: Mi perfil usa el del panel, como Cuenta. Las pantallas de una sola
 * columna de texto ponen su propio `max-w-*`.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
