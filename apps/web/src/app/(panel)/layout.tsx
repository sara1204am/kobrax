import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import type { AuthAccountOption, MeInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { PanelShell } from '@/components/panel-shell';
import { PermissionsProvider } from '@/components/permissions';
import { ToastProvider } from '@/components/toast';
import { visibleNav } from '@/lib/nav';

/**
 * Layout de todo lo que vive detrás del login.
 *
 * `(panel)` es un *route group*: agrupa sin aparecer en la URL, así que `/dashboard` y
 * `/settings/**` siguen siendo las mismas rutas y **el matcher de `middleware.ts` no cambia**.
 * Eso no exime a los módulos que vienen: cada ruta privada nueva sigue teniendo que entrar al
 * matcher.
 *
 * Es la única puerta por la que entra la identidad del panel: las dos llamadas van juntas y
 * de acá bajan como props. Ninguna pantalla vuelve a pedir `/auth/me`.
 */
export default async function PanelLayout({ children }: { children: ReactNode }) {
  const [me, accounts] = await Promise.all([
    apiCall<MeInfo>('/auth/me', { method: 'GET', auth: true }),
    apiCall<AuthAccountOption[]>('/auth/accounts', { method: 'GET', auth: true }),
  ]);

  // La API no contestó: no es que la sesión se venció, es que del otro lado no hay nadie.
  // Mandar a `/login` sería mentir —ahí tampoco va a poder entrar— y además esconde el
  // problema real.
  if (me.status === 0) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-k-bg px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[20px] font-semibold text-k-navy">{me.body.error?.message}</h1>
          <p className="mt-2 text-[14px] text-k-text-2">
            Vuelve a intentarlo en un momento. Si sigue así, avísale a tu administrador.
          </p>
        </div>
      </main>
    );
  }

  // El middleware ya refrescó el token si hacía falta; si aun así no hay identidad, la sesión
  // se terminó de verdad.
  if (me.status !== 200 || !me.body.data) redirect('/login');
  const user = me.body.data;

  return (
    <PermissionsProvider permissions={user.permissions}>
      <PanelShell
        user={{
          name: user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.email,
          email: user.email,
          role: user.role,
          accountId: user.accountId,
        }}
        // Si la lista falla, el panel funciona igual: el selector de empresa simplemente no
        // aparece. Es un adorno de la topbar, no la puerta de entrada.
        accounts={accounts.body.data ?? []}
        nav={visibleNav(user.permissions)}
      >
        {/* Los avisos se montan una sola vez acá: un provider por pantalla haría que un toast
            disparado antes de navegar se pierda con el desmontaje. */}
        <ToastProvider>{children}</ToastProvider>
      </PanelShell>
    </PermissionsProvider>
  );
}
