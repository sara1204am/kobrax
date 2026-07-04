import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { apiCall } from '@/lib/bff';
import { PanelNav } from '@/components/panel-nav';
import { LogoutButton } from '../dashboard/logout-button';

interface Me {
  email: string;
  role: string;
  profile: { firstName: string; lastName: string } | null;
}

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const { status, body } = await apiCall<Me>('/auth/me', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) redirect('/login');
  const me = body.data;
  const name = me.profile ? `${me.profile.firstName} ${me.profile.lastName}` : me.email;

  return (
    <div className="flex min-h-screen bg-k-bg">
      <aside className="flex w-56 shrink-0 flex-col bg-k-navy px-4 py-6">
        <Link href="/panel/clients" className="px-2 text-lg font-semibold tracking-tight text-white">
          KOBRAX
        </Link>
        <p className="px-2 text-[11px] text-white/50">Cartera</p>
        <PanelNav />
        <div className="mt-auto border-t border-white/10 pt-4">
          <p className="px-2 text-[13px] font-medium text-white">{name}</p>
          <p className="px-2 text-[11px] text-white/50">{me.role}</p>
          <div className="mt-2 flex items-center gap-3 px-2">
            <Link href="/settings/security" className="text-[12px] text-white/70 hover:text-white">
              Seguridad
            </Link>
            <LogoutButton />
          </div>
        </div>
      </aside>

      <main className="flex-1 px-8 py-8">{children}</main>
    </div>
  );
}
