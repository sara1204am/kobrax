import {
  HIDEABLE_MODULES,
  WORKSPACE_PRESETS,
  presetOf,
  sameWorkspace,
  type Workspace,
  type WorkspaceModuleKey,
  type WorkspaceOptionKey,
  type WorkspacePresetKey,
} from '@kobrax/shared';

/**
 * Lógica pura del asistente de configuración (F15 · P7, D-11). Sin React: el componente solo dibuja.
 *
 * Todo lo que el asistente decide vive en un borrador en memoria (`Draft`) y se escribe **una sola vez** al final
 * (`saveBody`). Cerrar a la mitad no deja una configuración a medias: no se escribe nada hasta confirmar.
 */

export const WIZARD_STEPS = [
  'welcome',
  'menu',
  'how',
  'clients',
  'credits',
  'preview',
  'confirm',
  'done',
] as const;
export type WizardStep = (typeof WIZARD_STEPS)[number];
/** Los pasos que se pueden omitir uno por uno («Dejar como está»): del 2 al 5. */
export const SKIPPABLE_STEPS: readonly WizardStep[] = ['menu', 'how', 'clients', 'credits'];

export type Draft = Pick<Workspace, 'hiddenModules' | 'options'>;

/** Lo que cuenta la cuenta hoy: con más de un miembro u oficina, ocultar Equipo, Actividad u Organización lo rechaza el servidor. */
export interface Usage {
  users?: number;
  branches?: number;
}

/** Módulos que NO se pueden ocultar ahora mismo (salvaguardas S-1/S-2/S-7 del servidor). Una cuenta nueva no tiene ninguno. */
export function blockedModules(usage: Usage | undefined): Set<WorkspaceModuleKey> {
  const out = new Set<WorkspaceModuleKey>();
  if ((usage?.users ?? 1) > 1) {
    out.add('team');
    out.add('activity');
  }
  if ((usage?.branches ?? 1) > 1) out.add('organization');
  return out;
}

export const draftOf = (
  w: Pick<Workspace, 'hiddenModules' | 'options'> | undefined | null,
): Draft => ({
  hiddenModules: [...(w?.hiddenModules ?? [])],
  options: { ...(w?.options ?? {}) },
});

/** El preset como borrador, sin lo que el servidor rechazaría hoy. */
export function presetDraft(
  key: WorkspacePresetKey,
  blocked: ReadonlySet<WorkspaceModuleKey>,
): Draft {
  const p = WORKSPACE_PRESETS[key];
  return {
    hiddenModules: p.hiddenModules.filter((m) => !blocked.has(m)),
    options: { ...p.options },
  };
}

export const isModuleShown = (d: Draft, key: WorkspaceModuleKey): boolean =>
  !d.hiddenModules.includes(key);

export function setModuleShown(
  d: Draft,
  key: WorkspaceModuleKey,
  shown: boolean,
  blocked: ReadonlySet<WorkspaceModuleKey>,
): Draft {
  if (!HIDEABLE_MODULES.includes(key) || (!shown && blocked.has(key))) return d;
  const rest = d.hiddenModules.filter((m) => m !== key);
  return { ...d, hiddenModules: shown ? rest : [...rest, key] };
}

export const isOptionShown = (d: Draft, key: WorkspaceOptionKey): boolean =>
  d.options[key] !== false;

export function setOptionShown(d: Draft, key: WorkspaceOptionKey, shown: boolean): Draft {
  const options = { ...d.options };
  if (shown) delete options[key];
  else options[key] = false;
  return { ...d, options };
}

/** «¿Trabajas con un equipo?»: decir que no oculta Equipo **y** Actividad (que sin equipo no dice nada). */
export function setTeamWork(
  d: Draft,
  yes: boolean,
  blocked: ReadonlySet<WorkspaceModuleKey>,
): Draft {
  return setModuleShown(setModuleShown(d, 'team', yes, blocked), 'activity', yes, blocked);
}

/** La modalidad fija del alta de crédito, o `null` si cada crédito la elige. */
export function creditDefinitionOf(d: Draft): string | null {
  const v = d.options['credit.definition'];
  return typeof v === 'string' ? v : null;
}

export function setCreditDefinition(d: Draft, value: string | null): Draft {
  const options = { ...d.options };
  if (value === null) delete options['credit.definition'];
  else options['credit.definition'] = value;
  return { ...d, options };
}

/**
 * «Opciones avanzadas» del crédito: ocultarlas esconde la sección y también el método de mora (que vive dentro, C-4); por
 * eso los dos se mueven juntos, igual que en el preset «Independiente».
 */
export function setAdvancedCredit(d: Draft, shown: boolean): Draft {
  return setOptionShown(setOptionShown(d, 'credit.advanced', shown), 'credit.arrearsMethod', shown);
}

/** Lo que cambia frente a «Completo», para la vista previa y la confirmación. */
export function changesFromComplete(d: Draft): {
  modules: WorkspaceModuleKey[];
  options: WorkspaceOptionKey[];
  definition: string | null;
} {
  const modules = HIDEABLE_MODULES.filter((m) => d.hiddenModules.includes(m));
  const options = (Object.keys(d.options) as WorkspaceOptionKey[]).filter(
    (k) => d.options[k] === false,
  );
  return { modules, options, definition: creditDefinitionOf(d) };
}

/**
 * El cuerpo de la única escritura del asistente. El `workspace` solo viaja si algo cambió respecto a lo guardado;
 * `onboarding` siempre: quién y cuándo los pone el servidor.
 */
export function saveBody(
  base: Workspace,
  draft: Draft,
): {
  workspace?: Workspace;
  onboarding: { status: 'done'; preset: WorkspacePresetKey | 'custom' };
} {
  const onboarding = { status: 'done' as const, preset: presetOf(draft) };
  if (sameWorkspace(base, draft)) return { onboarding };
  return {
    workspace: {
      version: 1,
      rev: base.rev,
      hiddenModules: draft.hiddenModules as WorkspaceModuleKey[],
      options: draft.options,
    },
    onboarding,
  };
}

/** «Hacerlo después» / cerrar con la X: la cuenta queda como estaba y el asistente no vuelve a salir solo. */
export const SKIP_BODY = { onboarding: { status: 'skipped' as const } };

export type SaveFailure = 'conflict' | 'blocked' | 'invalid' | 'generic';

/** Qué falló, según el código del servidor (no el status: el 409 también lo usa el cambio de sesión). */
export function failureOf(data: unknown): SaveFailure {
  const code = (data as { error?: { code?: string } } | null)?.error?.code;
  if (code === 'WORKSPACE_CONFLICT') return 'conflict';
  if (code === 'WORKSPACE_BLOCKED') return 'blocked';
  if (code === 'WORKSPACE_INVALID') return 'invalid';
  return 'generic';
}
