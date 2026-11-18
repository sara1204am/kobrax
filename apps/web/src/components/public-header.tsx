import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Cabecera de las páginas públicas y de la consola de plataforma: el mismo fondo navy, logo y nombre que el encabezado del menú lateral del
 * panel (`Brand` de `panel-shell`), para que se vea la misma marca antes y después de iniciar sesión. `children` va a la derecha (un enlace o
 * un botón).
 */
export function PublicHeader({ children, label }: { children?: ReactNode; label?: string }) {
  return (
    <header className="bg-k-navy">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-5">
        <Link href="/" className="flex items-center gap-3" aria-label="Kobrax">
          {/* eslint-disable-next-line @next/next/no-img-element -- 28px fijos, no necesita el optimizador */}
          <img src="/logo.png" alt="" width={28} height={28} className="h-7 w-7 shrink-0 object-contain" />
          <span className="text-k-xl font-semibold tracking-[0.16em] text-white">KOBRAX</span>
          {label && <span className="hidden text-k-sm font-medium tracking-[0.12em] text-white/70 sm:inline">· {label}</span>}
        </Link>
        {children}
      </div>
    </header>
  );
}

/** Enlace de la derecha de la cabecera (sobre navy: blanco, subrayado al pasar). */
export function PublicHeaderLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-k-sm font-medium text-white/80 hover:text-white hover:underline">
      {children}
    </Link>
  );
}
