import Link from 'next/link';

const OPTIONS = [
  { href: '/settings/security/password', title: 'Contraseña', desc: 'Cambia tu contraseña de acceso.' },
  { href: '/settings/security/mfa', title: 'Verificación en dos pasos (MFA)', desc: 'Protege tu cuenta con un segundo factor.' },
  { href: '/settings/security/sessions', title: 'Sesiones activas', desc: 'Revisa y cierra sesiones en otros dispositivos.' },
];

export default function SecurityHub() {
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold text-k-navy">Seguridad</h1>
      <div className="space-y-3">
        {OPTIONS.map((o) => (
          <Link
            key={o.href}
            href={o.href}
            className="flex items-center justify-between rounded-2xl border border-k-border bg-white px-5 py-4 shadow-k-card transition-all hover:border-k-periwinkle"
          >
            <span>
              <span className="block text-[15px] font-medium text-k-text">{o.title}</span>
              <span className="block text-[13px] text-k-text-2">{o.desc}</span>
            </span>
            <span aria-hidden className="text-k-muted">›</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
