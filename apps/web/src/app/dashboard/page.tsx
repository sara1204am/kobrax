import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiCall } from '@/lib/bff';
import { LogoutButton } from './logout-button';

interface Me {
  userId: string;
  email: string;
  profile: { firstName: string; lastName: string; photoUrl?: string } | null;
  accountId: string;
  role: string;
  permissions: string[];
}

/**
 * Aterrizaje post-login (server component): hidrata identidad desde /auth/me.
 *
 * ponytail: pantalla mínima a propósito. Es el destino al que apuntan `app/page.tsx`,
 * `lib/client.ts`, `select-account` y `settings/layout`, así que la ruta tiene que
 * existir — pero el panel real se construye módulo por módulo contra los endpoints
 * que ya usa el móvil, no contra los CRUD genéricos que vivían en `/panel`.
 */
export default async function DashboardPage() {
  const { status, body } = await apiCall<Me>('/auth/me', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) redirect('/login');
  const me = body.data;
  const name = me.profile ? `${me.profile.firstName} ${me.profile.lastName}` : me.email;

  return (
    <main className="min-h-screen bg-k-bg">
      <header className="flex items-center justify-between bg-k-navy px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-white">KOBRAX</span>
        <div className="flex items-center gap-4">
          <Link href="/settings/security" className="text-[13px] font-medium text-white/90 hover:text-white">
            Seguridad
          </Link>
          <LogoutButton />
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold text-k-navy">Hola, {name}</h1>
        <p className="mt-1 text-[14px] text-k-text-2">
          Sesión iniciada como <span className="font-medium text-k-text">{me.role}</span>.
        </p>
        <p className="mt-6 text-[14px] text-k-muted">El panel está en construcción.</p>
      </section>
    </main>
  );
}
