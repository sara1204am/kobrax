import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Permission, type AuthAccountOption, type MeInfo } from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { getAgendaSummary } from '@/lib/agenda-summary';
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
    const t = await getTranslations('panel.offline');
    return (
      <main className="flex min-h-screen items-center justify-center bg-k-bg px-6">
        <div className="max-w-md text-center">
          <h1 className="text-[20px] font-semibold text-k-navy">{t('title')}</h1>
          <p className="mt-2 text-[14px] text-k-text-2">{t('text')}</p>
        </div>
      </main>
    );
  }

  // El middleware ya refrescó el token si hacía falta; si aun así no hay identidad, la sesión
  // se terminó de verdad.
  if (me.status !== 200 || !me.body.data) redirect('/login');
  // `sessionId` lo agrega la API a /auth/me (W-LOG-54); el tipo compartido todavía no lo declara.
  const user: MeInfo & { sessionId?: string } = me.body.data;

  /*
   * El contador de «Agenda» en el menú: vencidas + pendientes de hoy, **las mismas** que cuenta el Inicio y la lista
   * (el servidor las calcula con el día civil de la empresa, así que no cambia con la zona horaria del navegador).
   * Si no responde, el menú sale sin número: es un aviso, no una dependencia.
   */
  const today = user.permissions.includes(Permission.AGENDA_READ) ? await getAgendaSummary() : null;
  const agendaCount = today ? today.overdue + today.pending : 0;
  const badges = agendaCount > 0 ? { agenda: { count: agendaCount, urgent: (today?.overdue ?? 0) > 0 } } : undefined;

  return (
    <PermissionsProvider permissions={user.permissions}>
      <PanelShell
        user={{
          userId: user.userId,
          sessionId: user.sessionId,
          name: user.profile ? `${user.profile.firstName} ${user.profile.lastName}` : user.email,
          email: user.email,
          role: user.role,
          accountId: user.accountId,
          photoUrl: user.profile?.photoUrl,
        }}
        // Si la lista falla, el panel funciona igual: el selector de empresa simplemente no
        // aparece. Es un adorno de la topbar, no la puerta de entrada.
        accounts={accounts.body.data ?? []}
        nav={visibleNav(user.permissions)}
        badges={badges}
      >
        {/* Los avisos se montan una sola vez acá: un provider por pantalla haría que un toast
            disparado antes de navegar se pierda con el desmontaje. */}
        <ToastProvider>{children}</ToastProvider>
      </PanelShell>
    </PermissionsProvider>
  );
}
