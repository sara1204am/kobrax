import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Permission, shouldOfferWizard, type AuthAccountOption, type MeInfo } from '@kobrax/shared';
import { getMe } from '@/lib/authz';
import { apiCall } from '@/lib/bff';
import { getAgendaSummary } from '@/lib/agenda-summary';
import { getAccount } from './cuenta/get-account';
import { PanelShell } from '@/components/panel-shell';
import { AccountBrandProvider } from '@/components/account-brand';
import { PermissionsProvider } from '@/components/permissions';
import { WorkspaceProvider } from '@/components/workspace';
import { HiddenModuleNotice } from '@/components/hidden-module-notice';
import { ToastProvider } from '@/components/toast';
import { OnboardingWizard } from '@/components/onboarding-wizard';
import { OnboardingCards } from '@/components/onboarding-cards';
import { TourProvider } from '@/components/tour';
import { visibleNav } from '@/lib/nav';
import { WORKSPACE_MODULES, type WorkspaceNavKey } from '@kobrax/shared';

const KNOWN_MODULES = new Set<string>(WORKSPACE_MODULES.map((m) => m.key));

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
    getMe(),
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
  const badges =
    agendaCount > 0
      ? { agenda: { count: agendaCount, urgent: (today?.overdue ?? 0) > 0 } }
      : undefined;

  /*
   * Faltan datos fiscales: el aviso sólo le sale a quien puede completarlos. Si la cuenta no responde, el panel
   * sigue sin el aviso (es un recordatorio, no una dependencia).
   */
  const account = user.permissions.includes(Permission.ACCOUNT_WRITE)
    ? (await getAccount()).body.data
    : null;
  const billingMissing = account?.billingMissing ?? [];

  const nav = visibleNav(user.permissions, user.account?.workspace);
  const visibleNavKeys = nav
    .map((n) => n.label)
    .filter((k): k is WorkspaceNavKey => KNOWN_MODULES.has(k));

  return (
    <PermissionsProvider permissions={user.permissions}>
      <WorkspaceProvider workspace={user.account?.workspace}>
        <AccountBrandProvider brand={user.account ?? null}>
          {/* F15 · P9: el recorrido con spotlight envuelve el panel para que el botón «?» de la barra lo lance. */}
          <TourProvider
            key={user.accountId}
            visibleNavKeys={visibleNavKeys}
            multipleAccounts={(accounts.body.data ?? []).length > 1}
          >
            <PanelShell
              user={{
                userId: user.userId,
                sessionId: user.sessionId,
                name: user.profile
                  ? `${user.profile.firstName} ${user.profile.lastName}`
                  : user.email,
                email: user.email,
                role: user.role,
                accountId: user.accountId,
                photoUrl: user.profile?.photoUrl,
              }}
              // Si la lista falla, el panel funciona igual: el selector de empresa simplemente no
              // aparece. Es un adorno de la topbar, no la puerta de entrada.
              accounts={accounts.body.data ?? []}
              nav={nav}
              badges={badges}
              billingMissing={billingMissing}
              supportSession={user.supportSession}
            >
              {/* Los avisos se montan una sola vez acá: un provider por pantalla haría que un toast
            disparado antes de navegar se pierda con el desmontaje. */}
              <ToastProvider>
                {/* F15: el aviso de «ese módulo está oculto» (`?oculto=`), en la pantalla a la que se volvió. */}
                <HiddenModuleNotice
                  canManage={user.permissions.includes(Permission.ACCOUNT_WRITE)}
                />
                {/* F15 · P7 (D-14): el asistente de configuración, solo a quien administra una cuenta NUEVA (estado `pending`, que
              el servidor pone al crearla). Una cuenta anterior no tiene estado y no lo recibe. Llega después de MFA: aquí ya hay sesión. */}
                {account && shouldOfferWizard(user.account?.onboarding?.status) && (
                  // `key` = `rev`: tras «Recargar» por un conflicto el asistente vuelve a montarse con lo último guardado.
                  <OnboardingWizard key={account.workspace?.rev ?? 0} account={account} />
                )}
                {/* F15 · P8: bienvenida del primer ingreso y «primeros pasos», solo en las pantallas de aterrizaje y en cuentas nuevas. */}
                <OnboardingCards me={user} />
                {children}
              </ToastProvider>
            </PanelShell>
          </TourProvider>
        </AccountBrandProvider>
      </WorkspaceProvider>
    </PermissionsProvider>
  );
}
