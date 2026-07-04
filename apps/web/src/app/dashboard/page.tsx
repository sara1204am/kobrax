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

/** Dashboard protegido (server component): hidrata identidad desde /auth/me. */
export default async function DashboardPage() {
  const { status, body } = await apiCall<Me>('/auth/me', { method: 'GET', auth: true });
  if (status !== 200 || !body.data) redirect('/login');
  const me = body.data!;
  const name = me.profile ? `${me.profile.firstName} ${me.profile.lastName}` : me.email;

  return (
    <main className="min-h-screen bg-k-bg">
      <header className="flex items-center justify-between bg-k-navy px-6 py-4">
        <span className="text-lg font-semibold tracking-tight text-white">KOBRAX</span>
        <div className="flex items-center gap-4">
          <Link href="/panel/clients" className="text-[13px] font-medium text-white/90 hover:text-white">
            Cartera
          </Link>
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

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card label="Correo" value={me.email} />
          <Card label="Empresa activa" value={me.accountId} mono />
        </div>

        <div className="mt-6 rounded-2xl border border-k-border bg-white p-5 shadow-k-card">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-k-text-2">
            Permisos ({me.permissions.length})
          </h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {me.permissions.map((p) => (
              <span key={p} className="rounded-full bg-k-highlight px-2.5 py-1 font-mono text-[12px] text-k-purple">
                {p}
              </span>
            ))}
          </div>
        </div>

        <Link
          href="/panel/clients"
          className="mt-8 inline-flex items-center gap-2 rounded-xl bg-k-navy px-5 py-3 text-[14px] font-medium text-white hover:bg-k-slate"
        >
          Ir a la cartera (clientes · créditos · casos) →
        </Link>
      </section>
    </main>
  );
}

function Card({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-k-border bg-white p-4 shadow-k-card">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-k-text-2">{label}</p>
      <p className={`mt-1 break-all text-[15px] text-k-text ${mono ? 'font-mono text-[13px]' : ''}`}>{value}</p>
    </div>
  );
}
