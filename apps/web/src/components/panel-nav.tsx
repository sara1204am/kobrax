'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/panel/clients', label: 'Clientes', icon: '👥' },
  { href: '/panel/credits', label: 'Créditos', icon: '💳' },
  { href: '/panel/cases', label: 'Casos', icon: '📁' },
];

export function PanelNav() {
  const path = usePathname();
  return (
    <nav className="mt-6 flex flex-col gap-1">
      {ITEMS.map((i) => {
        const active = path.startsWith(i.href);
        return (
          <Link
            key={i.href}
            href={i.href}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[14px] transition-colors ${
              active ? 'bg-k-slate font-medium text-white' : 'text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            <span aria-hidden>{i.icon}</span>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
