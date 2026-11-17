'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export interface LinkTabItem {
  key: string;
  href: string;
  label: ReactNode;
  /** Punto/insignia a la derecha del texto (por ejemplo «pendiente de facturación»). */
  badge?: ReactNode;
}

/**
 * Pestañas que son **enlaces a rutas** (no estado): cada una se abre, se recarga y se comparte. Es la pareja de `Tabs` (form-kit),
 * que cambia contenido dentro de la misma pantalla. La activa es la que coincide con la ruta actual o con una subruta.
 *
 * `onNavigate` recibe el clic de una pestaña NO activa; si devuelve `false`, no se navega (p. ej. «hay cambios sin guardar»).
 */
export function LinkTabs({
  tabs,
  label,
  onNavigate,
  className = 'mb-6',
}: {
  tabs: LinkTabItem[];
  /** Qué agrupan estas pestañas (nombre accesible de la navegación). */
  label: string;
  onNavigate?: (tab: LinkTabItem) => boolean;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label={label} className={`flex gap-1 overflow-x-auto border-b border-k-border ${className}`}>
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              if (!active && onNavigate && !onNavigate(tab)) e.preventDefault();
            }}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-k-base font-medium ${
              active
                ? 'border-k-periwinkle font-semibold text-k-periwinkle'
                : 'border-transparent text-k-text-2 hover:text-k-navy'
            }`}
          >
            {tab.label}
            {tab.badge}
          </Link>
        );
      })}
    </nav>
  );
}
