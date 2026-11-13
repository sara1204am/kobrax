import {
  Permission,
  WORKSPACE_MODULES,
  firstSteps,
  parseGuideState,
  shouldOfferWizard,
  type FirstStep,
  type GuideState,
  type MeInfo,
  type WorkspaceNavKey,
} from '@kobrax/shared';
import { apiCall } from '@/lib/bff';
import { visibleNav } from '@/lib/nav';
import { OnboardingCardsView } from '@/components/onboarding-cards-view';

/** Cuántos hay de algo, sin traerlo: una página de un elemento y el `total` de la respuesta. `undefined` = no se pudo leer. */
async function totalOf(path: string): Promise<number | undefined> {
  try {
    const { status, body } = await apiCall<unknown[]>(`${path}?limit=1`, {
      method: 'GET',
      auth: true,
    });
    if (status !== 200) return undefined;
    return body.meta?.total ?? body.data?.length ?? 0;
  } catch {
    return undefined;
  }
}

/** Los módulos que se listan en la bienvenida: los del menú que la persona ve, sin los que todo el mundo tiene. */
const WELCOME_SKIP: readonly WorkspaceNavKey[] = ['home', 'profile', 'accessSecurity', 'account'];
const KNOWN_MODULES = new Set<string>(WORKSPACE_MODULES.map((m) => m.key));

/**
 * La bienvenida del invitado y los «primeros pasos» (F15 · P8, propuesta §3.1 y §3.3).
 *
 * Solo en cuentas **nuevas** (las que nacieron con estado de asistente): una cuenta anterior a F15 no recibe nada. Nunca a
 * quien está viendo el asistente de configuración (D-14). Lo único guardado es qué tarjetas se cerraron
 * (`GET /users/me/guides`); el avance de «primeros pasos» sale de datos reales. Cualquier fallo de lectura la deja sin tarjeta:
 * es un adorno de la pantalla de aterrizaje, no una dependencia.
 *
 * Costo: una lectura del estado y, solo mientras la tarjeta de pasos siga abierta, tres lecturas de un elemento en paralelo.
 * Al completarse todo, la tarjeta se da por cerrada (se guarda una vez) y deja de consultar.
 */
export async function OnboardingCards({ me }: { me: MeInfo }) {
  const status = me.account?.onboarding?.status;
  const permissions = me.permissions ?? [];
  if (!status) return null; // cuenta anterior a F15
  if (permissions.includes(Permission.ACCOUNT_WRITE) && shouldOfferWizard(status)) return null; // ya ve el asistente

  let state: GuideState;
  try {
    const res = await apiCall<GuideState>('/users/me/guides', { method: 'GET', auth: true });
    if (res.status !== 200) return null;
    state = parseGuideState(res.body.data);
  } catch {
    return null;
  }
  if (state.welcomeSeen && state.firstStepsClosed) return null;

  const nav = visibleNav(permissions, me.account?.workspace);
  const visibleNavKeys = nav
    .map((n) => n.label)
    .filter((k): k is WorkspaceNavKey => KNOWN_MODULES.has(k));

  let steps: FirstStep[] | null = null;
  let completed = false;
  if (!state.firstStepsClosed) {
    const [clients, credits, payments] = await Promise.all([
      totalOf('/clients'),
      totalOf('/credits'),
      totalOf('/payments'),
    ]);
    const view = firstSteps({
      visibleNavKeys,
      permissions,
      counts: { clients, credits, payments },
    });
    if (view.complete) completed = true;
    else if (view.steps.length > 0) steps = view.steps;
  }

  // La bienvenida es del primer ingreso a esa organización. Quien configuró la cuenta ya la dio por vista al terminar el asistente.
  const showWelcome = !state.welcomeSeen;
  if (!showWelcome && !steps && !completed) return null;

  return (
    <OnboardingCardsView
      welcome={
        showWelcome
          ? {
              orgName: me.account?.name ?? '',
              role: me.roleKey ?? me.role ?? '',
              modules: visibleNavKeys.filter((k) => !WELCOME_SKIP.includes(k)),
            }
          : null
      }
      steps={steps}
      closeStepsNow={completed}
    />
  );
}
