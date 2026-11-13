/**
 * Catálogo de guías (F15 · P5): la única fuente de lo que enseñan el recorrido con spotlight (P9), las guías de pantalla y
 * el Centro de ayuda (P10) y, más adelante, el asistente (P7).
 *
 * Es solo estructura: ids, orden, anclas y requisitos. **Los textos no viven aquí** (Q-1): cada entrada lleva una clave
 * `guides.<id>` y la web resuelve `title`, `what`, `does` y `startWith` en `apps/web/src/messages` (es/en, con paridad).
 *
 * Reglas:
 *  - R1 solo quita: el catálogo nunca agrega un paso que el permiso, el plan o el workspace no permiten. La web pasa las
 *    claves del menú que ya filtró (`visibleNav`: plan ∧ permiso ∧ workspace) y esto solo descarta; nunca añade.
 *  - R2 la API no consulta nada de esto.
 *  - La disponibilidad de un paso se calcula en cada render; no se guarda (el progreso real se deriva de datos).
 */
import { WORKSPACE_MODULES, type WorkspaceNavKey } from './workspace.js';

/** Se sube cuando cambian ids o anclas; el estado de guías de la persona (P6) la guarda para saber qué ya vio. */
export const GUIDE_CATALOG_VERSION = 1;

/** Elementos de la barra superior que el recorrido enfoca, en el orden en que se ven. */
export type GuideTopbarKey =
  | 'language'
  | 'help'
  | 'notifications'
  | 'sessionMenu'
  | 'accountSwitcher';

export interface TourStep {
  /** Estable: `tour.nav.<clave del menú>` o `tour.topbar.<clave>`. */
  id: string;
  kind: 'nav' | 'topbar';
  /** La clave del menú (`nav`) o del elemento de la barra (`topbar`). */
  key: WorkspaceNavKey | GuideTopbarKey;
  /** Identificador de ancla (no un selector CSS): la pantalla lo pone en el elemento real. */
  target: string;
  /** Base de las claves de texto: `<textKey>.title|what|does|startWith`. */
  textKey: string;
}

/** El menú, en el orden del `NAV` de la web: se deriva de `WORKSPACE_MODULES`, así que un módulo nuevo entra solo. */
const NAV_ORDER: readonly WorkspaceNavKey[] = WORKSPACE_MODULES.map((m) => m.key);

const TOPBAR_ORDER: readonly GuideTopbarKey[] = [
  'language',
  'help',
  'notifications',
  'sessionMenu',
  'accountSwitcher',
];

/** El recorrido general completo: el menú y después la barra superior. Es lo máximo; `guideSteps` lo recorta por persona. */
export const TOUR_STEPS: readonly TourStep[] = [
  ...NAV_ORDER.map(
    (key): TourStep => ({
      id: `tour.nav.${key}`,
      kind: 'nav',
      key,
      target: `nav.${key}`,
      textKey: `guides.tour.nav.${key}`,
    }),
  ),
  ...TOPBAR_ORDER.map(
    (key): TourStep => ({
      id: `tour.topbar.${key}`,
      kind: 'topbar',
      key,
      target: `topbar.${key}`,
      textKey: `guides.tour.topbar.${key}`,
    }),
  ),
];

export interface GuideContext {
  /** Las claves del menú que esta persona ve, ya filtradas por plan ∧ permiso ∧ workspace (`visibleNav` de la web). */
  visibleNavKeys: readonly WorkspaceNavKey[];
  /** ¿Pertenece a más de una organización? El cambio de organización solo existe entonces. */
  multipleAccounts?: boolean;
}

/**
 * Los pasos del recorrido general para esta persona, en el orden en que se ven. Un módulo oculto o sin permiso se salta
 * solo; el cambio de organización solo sale si hay más de una. Nunca devuelve un paso que no esté en `TOUR_STEPS`.
 */
export function guideSteps(ctx: GuideContext): TourStep[] {
  const visible = new Set<string>(ctx.visibleNavKeys);
  return TOUR_STEPS.filter((s) => {
    if (s.kind === 'nav') return visible.has(s.key);
    if (s.key === 'accountSwitcher') return ctx.multipleAccounts === true;
    return true;
  });
}

// ── Guías de pantalla (P10) ──────────────────────────────────────────────────────────────────────────────────────────

/** Los módulos que tienen guía de pantalla en la primera versión (D-16: Mora, Agenda y Pagos tal como existen hoy). */
export type ScreenGuideModule =
  | 'portfolio'
  | 'mora'
  | 'agenda'
  | 'payments'
  | 'routes'
  | 'team'
  | 'organization';

export interface ScreenStep {
  /** Estable: `screen.<módulo>.<acción>`. */
  id: string;
  module: ScreenGuideModule;
  /** La acción o botón principal que señala. */
  action: string;
  target: string;
  textKey: string;
}

const screen = (module: ScreenGuideModule, action: string): ScreenStep => ({
  id: `screen.${module}.${action}`,
  module,
  action,
  target: `screen.${module}.${action}`,
  textKey: `guides.screen.${module}.${action}`,
});

/** 2 a 4 pasos por módulo, en el orden en que se ven en pantalla. */
export const SCREEN_GUIDES: Readonly<Record<ScreenGuideModule, readonly ScreenStep[]>> = {
  portfolio: [
    screen('portfolio', 'newClient'),
    screen('portfolio', 'filters'),
    screen('portfolio', 'clientCard'),
  ],
  mora: [screen('mora', 'list'), screen('mora', 'filters'), screen('mora', 'registerActivity')],
  agenda: [screen('agenda', 'today'), screen('agenda', 'promises')],
  payments: [screen('payments', 'list'), screen('payments', 'register')],
  routes: [screen('routes', 'plan'), screen('routes', 'visits')],
  team: [screen('team', 'invite'), screen('team', 'roles')],
  organization: [screen('organization', 'offices'), screen('organization', 'assign')],
};

/** Los pasos de la guía de pantalla de un módulo, o `[]` si esa persona no ve el módulo (R1). */
export function screenGuideSteps(
  module: ScreenGuideModule,
  ctx: Pick<GuideContext, 'visibleNavKeys'>,
): ScreenStep[] {
  return ctx.visibleNavKeys.includes(module) ? [...SCREEN_GUIDES[module]] : [];
}

// ── Centro de ayuda (P10) ────────────────────────────────────────────────────────────────────────────────────────────

export interface HelpEntry {
  /** Estable: `help.<módulo>`. */
  id: string;
  module: WorkspaceNavKey;
  textKey: string;
  /** Las acciones que explica (los pasos de pantalla del módulo, si los tiene). */
  actions: ScreenStep[];
}

/** Una entrada de ayuda por cada módulo que la persona ve, en el orden del menú. Misma fuente que el recorrido. */
export function helpEntries(ctx: Pick<GuideContext, 'visibleNavKeys'>): HelpEntry[] {
  const visible = new Set<string>(ctx.visibleNavKeys);
  return NAV_ORDER.filter((m) => visible.has(m)).map((module) => ({
    id: `help.${module}`,
    module,
    textKey: `guides.help.${module}`,
    actions: [
      ...((SCREEN_GUIDES as Partial<Record<WorkspaceNavKey, readonly ScreenStep[]>>)[module] ?? []),
    ],
  }));
}
