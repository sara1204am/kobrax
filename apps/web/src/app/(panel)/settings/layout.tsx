import type { ReactNode } from 'react';

/**
 * Ajustes es texto y formularios de una columna: sin un ancho máximo, en un monitor de 1440
 * las líneas quedan larguísimas y se leen mal.
 *
 * Lo único que hacía el layout anterior además de esto era pintar su propia barra navy —
 * eso ahora lo pone el shell, y por eso se borró.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <div className="max-w-2xl">{children}</div>;
}
