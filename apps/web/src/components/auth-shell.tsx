import type { ReactNode } from 'react';
import { SecurityFooter } from './ui';

/**
 * Contenedor de las pantallas de auth: hero con gradiente (token) + wave blanca,
 * y una card centrada con el contenido del paso. Layout web `padding 48 24 60`.
 */
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-k-bg">
      <header className="relative bg-k-hero px-6 pb-16 pt-12 text-center">
        <div className="mx-auto max-w-md">
          <span className="text-2xl font-semibold tracking-tight text-white">KOBRAX</span>
          <p className="mt-1 text-[13px] text-white/70">Gestión inteligente de cobranzas</p>
        </div>
        {/* wave blanca (radius 36 arriba) */}
        <div className="absolute inset-x-0 -bottom-px h-9 rounded-t-[36px] bg-k-bg" />
      </header>

      <section className="mx-auto -mt-6 w-full max-w-md flex-1 px-6">
        <div className="rounded-2xl border border-k-border bg-white p-6 shadow-k-card">
          <h1 className="text-2xl font-semibold text-k-navy">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-k-text-2">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        <SecurityFooter />
      </section>
    </main>
  );
}
