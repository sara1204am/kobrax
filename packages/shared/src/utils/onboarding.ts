/**
 * Estado del onboarding (F15 · P6).
 *
 * Dos piezas, con dueños distintos (propuesta §2.4):
 *  - **De la organización** — `accounts.configuration.onboarding` (jsonb que ya existía, sin migración): si el asistente de
 *    configuración está pendiente, hecho u omitido. Lo resuelve quien tiene `account:write`; el primero que lo termina u
 *    omite lo resuelve para todos (D-14). `absent` = cuenta anterior a F15 = sin asistente.
 *  - **De cada persona en cada organización** — la tabla `user_guide_states` (D-13, D-17): qué guías vio, descartó o dejó a
 *    medias. El progreso real («ya tienes un cliente») NO se guarda: se deriva de datos.
 *
 * Funciones puras. Lo que dice el servidor lo valida `validateGuideStateInput`; lo que lee la pantalla pasa por
 * `parseGuideState`, que nunca lanza (un estado ilegible equivale a «no ha visto nada»).
 */
import { WORKSPACE_PRESETS, type WorkspacePresetKey } from './workspace.js';

// ── De la organización ──────────────────────────────────────────────────────────────────────────────────────────────

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STATUSES = ['pending', 'done', 'skipped'] as const;
export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
/** Lo único que un cliente puede declarar: resolver el asistente. `pending` lo pone el servidor al crear la cuenta. */
export const ONBOARDING_RESOLUTIONS = ['done', 'skipped'] as const;
export type OnboardingResolution = (typeof ONBOARDING_RESOLUTIONS)[number];

export interface OnboardingState {
  v: number;
  status: OnboardingStatus;
  /** Quién lo resolvió (users.id). Lo escribe el servidor, nunca el cliente. */
  decidedBy?: string;
  /** Cuándo (ISO). Lo escribe el servidor. */
  decidedAt?: string;
  /** El preset con el que terminó, solo informativo. */
  preset?: WorkspacePresetKey | 'custom';
}

/** Los valores válidos de `preset`: los de `WORKSPACE_PRESETS` y `custom`. */
export const ONBOARDING_PRESETS: readonly string[] = [...Object.keys(WORKSPACE_PRESETS), 'custom'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** El estado guardado, o `null` si la cuenta nunca lo tuvo (cuenta anterior a F15: sin asistente). Nunca lanza. */
export function parseOnboarding(configuration: unknown): OnboardingState | null {
  if (!isRecord(configuration)) return null;
  const raw = configuration.onboarding;
  if (!isRecord(raw)) return null;
  const status = raw.status;
  if (typeof status !== 'string' || !(ONBOARDING_STATUSES as readonly string[]).includes(status))
    return null;
  const out: OnboardingState = {
    v: typeof raw.v === 'number' ? raw.v : ONBOARDING_VERSION,
    status: status as OnboardingStatus,
  };
  if (typeof raw.decidedBy === 'string') out.decidedBy = raw.decidedBy;
  if (typeof raw.decidedAt === 'string') out.decidedAt = raw.decidedAt;
  // Un valor corrupto (editado a mano) no llega al tipo fuerte: solo un preset conocido o `custom`.
  if (typeof raw.preset === 'string' && ONBOARDING_PRESETS.includes(raw.preset))
    out.preset = raw.preset as OnboardingState['preset'];
  return out;
}

/** El estado con que nace una cuenta nueva. */
export function newAccountOnboarding(): OnboardingState {
  return { v: ONBOARDING_VERSION, status: 'pending' };
}

/** ¿Hay que ofrecer el asistente? Solo si está pendiente: una cuenta anterior (sin estado) o resuelta no lo recibe sola. */
export function shouldOfferWizard(status: OnboardingStatus | null | undefined): boolean {
  return status === 'pending';
}

/**
 * Aplica una resolución al estado guardado. **El primero que resuelve gana** (D-14): si ya está `done` o `skipped` se
 * conserva tal cual y `changed` es `false`. Una cuenta sin estado (anterior) sí puede resolverlo, p. ej. con «Revisar mi
 * espacio de trabajo».
 */
export function resolveOnboarding(
  current: OnboardingState | null,
  input: { status: OnboardingResolution; preset?: OnboardingState['preset'] },
  by: { userId: string; at: string },
): { state: OnboardingState; changed: boolean } {
  if (current && current.status !== 'pending') return { state: current, changed: false };
  const state: OnboardingState = {
    v: ONBOARDING_VERSION,
    status: input.status,
    decidedBy: by.userId,
    decidedAt: by.at,
  };
  if (input.preset) state.preset = input.preset;
  return { state, changed: true };
}

// ── De cada persona ─────────────────────────────────────────────────────────────────────────────────────────────────

export const GUIDE_STATE_VERSION = 1;
/** Tope del documento serializado, en bytes UTF-8 (una fila por persona y organización). */
export const GUIDE_STATE_MAX_BYTES = 4096;
export const GUIDE_STATE_MAX_SCREENS = 32;

export const TOUR_STATUSES = ['none', 'inProgress', 'done', 'skipped'] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];
export type ScreenGuideStatus = 'seen' | 'dismissed';

export interface GuideState {
  v: number;
  tour: {
    status: TourStatus;
    /** Índice del último paso visto (para «Seguir donde lo dejé»). */
    step: number;
    /** Versión del catálogo con que se recorrió: si cambia mucho, se puede reofrecer. */
    catalogVersion: number;
  };
  /** Por id de guía de pantalla (`screen.<módulo>`): vista o descartada. Ausente = no la ha visto. */
  screens: Record<string, ScreenGuideStatus>;
  /** La tarjeta de bienvenida del invitado ya se mostró. */
  welcomeSeen: boolean;
  /** La tarjeta de «primeros pasos» de Inicio se cerró a mano. */
  firstStepsClosed: boolean;
}

export function emptyGuideState(): GuideState {
  return {
    v: GUIDE_STATE_VERSION,
    tour: { status: 'none', step: 0, catalogVersion: 0 },
    screens: {},
    welcomeSeen: false,
    firstStepsClosed: false,
  };
}

const GUIDE_TOP_KEYS = ['v', 'tour', 'screens', 'welcomeSeen', 'firstStepsClosed'];
const GUIDE_TOUR_KEYS = ['status', 'step', 'catalogVersion'];
const SCREEN_KEY = /^[A-Za-z0-9._-]{1,64}$/;
const SCREEN_VALUES: readonly string[] = ['seen', 'dismissed'];
const byteLength = (text: string): number => new TextEncoder().encode(text).length;

/** Lectura tolerante: lo ilegible o ausente da el estado vacío. Descarta lo que no reconoce; nunca lanza. */
export function parseGuideState(raw: unknown): GuideState {
  const out = emptyGuideState();
  if (!isRecord(raw)) return out;
  if (isRecord(raw.tour)) {
    const t = raw.tour;
    if (typeof t.status === 'string' && (TOUR_STATUSES as readonly string[]).includes(t.status))
      out.tour.status = t.status as TourStatus;
    if (typeof t.step === 'number' && Number.isInteger(t.step) && t.step >= 0 && t.step < 1000)
      out.tour.step = t.step;
    if (
      typeof t.catalogVersion === 'number' &&
      Number.isInteger(t.catalogVersion) &&
      t.catalogVersion >= 0
    )
      out.tour.catalogVersion = t.catalogVersion;
  }
  if (isRecord(raw.screens)) {
    for (const [k, v] of Object.entries(raw.screens).slice(0, GUIDE_STATE_MAX_SCREENS)) {
      if (SCREEN_KEY.test(k) && typeof v === 'string' && SCREEN_VALUES.includes(v))
        out.screens[k] = v as ScreenGuideStatus;
    }
  }
  out.welcomeSeen = raw.welcomeSeen === true;
  out.firstStepsClosed = raw.firstStepsClosed === true;
  return out;
}

export type GuideStateErrorCode =
  | 'SHAPE'
  | 'TOUR'
  | 'SCREENS'
  | 'SCREEN_KEY'
  | 'SCREEN_VALUE'
  | 'FLAGS'
  | 'TOO_LARGE'
  | 'VERSION';
export interface GuideStateError {
  code: GuideStateErrorCode;
  field: string;
}
export type GuideStateValidation =
  | { ok: true; state: GuideState }
  | { ok: false; errors: GuideStateError[] };

/** Escritura estricta: rechaza lo que no reconoce en vez de descartarlo. Los topes se miden ANTES de recorrer. */
export function validateGuideStateInput(input: unknown): GuideStateValidation {
  const errors: GuideStateError[] = [];
  if (!isRecord(input)) return { ok: false, errors: [{ code: 'SHAPE', field: 'state' }] };
  if (byteLength(JSON.stringify(input)) > GUIDE_STATE_MAX_BYTES)
    return { ok: false, errors: [{ code: 'TOO_LARGE', field: 'state' }] };
  // Estricta de verdad: una clave que no existe se rechaza, no se descarta en silencio (el cliente creería que se guardó).
  for (const k of Object.keys(input))
    if (!GUIDE_TOP_KEYS.includes(k)) errors.push({ code: 'SHAPE', field: k.slice(0, 32) });
  if (input.v !== undefined && input.v !== GUIDE_STATE_VERSION)
    errors.push({ code: 'VERSION', field: 'v' });
  const t = input.tour;
  if (!isRecord(t)) errors.push({ code: 'TOUR', field: 'tour' });
  else {
    for (const k of Object.keys(t))
      if (!GUIDE_TOUR_KEYS.includes(k))
        errors.push({ code: 'TOUR', field: `tour.${k.slice(0, 32)}` });
    if (typeof t.status !== 'string' || !(TOUR_STATUSES as readonly string[]).includes(t.status))
      errors.push({ code: 'TOUR', field: 'tour.status' });
    if (typeof t.step !== 'number' || !Number.isInteger(t.step) || t.step < 0 || t.step >= 1000)
      errors.push({ code: 'TOUR', field: 'tour.step' });
    if (
      typeof t.catalogVersion !== 'number' ||
      !Number.isInteger(t.catalogVersion) ||
      t.catalogVersion < 0
    )
      errors.push({ code: 'TOUR', field: 'tour.catalogVersion' });
  }
  const s = input.screens;
  if (!isRecord(s)) errors.push({ code: 'SCREENS', field: 'screens' });
  else if (Object.keys(s).length > GUIDE_STATE_MAX_SCREENS)
    errors.push({ code: 'SCREENS', field: 'screens' });
  else {
    for (const [k, v] of Object.entries(s)) {
      if (!SCREEN_KEY.test(k))
        errors.push({ code: 'SCREEN_KEY', field: `screens.${k.slice(0, 32)}` });
      else if (typeof v !== 'string' || !SCREEN_VALUES.includes(v))
        errors.push({ code: 'SCREEN_VALUE', field: `screens.${k}` });
    }
  }
  for (const flag of ['welcomeSeen', 'firstStepsClosed'] as const) {
    if (typeof input[flag] !== 'boolean') errors.push({ code: 'FLAGS', field: flag });
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, state: parseGuideState(input) };
}
