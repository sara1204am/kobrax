import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shell de configuración: barra superior navy + contenedor centrado. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-k-bg">
      <header className="flex items-center justify-between bg-k-navy px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-white">KOBRAX</span>
        <Link href="/dashboard" className="text-[13px] font-medium text-white/90 hover:text-white">
          ← Volver al panel
        </Link>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-8">{children}</main>
    </div>
  );
}
