/**
 * Reglas de la agenda que comparten el teléfono y el escritorio: cómo se reparte el día y cómo se
 * arma una gestión.
 *
 * Los rótulos (`TIME_SLOT_LABEL`, los nombres de los meses, los días de la semana) **no viven
 * acá**: el panel es bilingüe y el móvil no, así que cada uno pone su texto. Acá va la regla.
 */
import { AgendaItemStatus, AgendaItemType, AgendaTimeSlot, ScheduleTimeMode } from '../enums/agenda.enum.js';
import { validateAgendaDetails, type AgendaDetails } from '../validation/agenda-details.js';
import type { AgendaListItem, CreateAgendaInput, UpdateAgendaInput } from '../types/agenda.types.js';

/**
 * Reparto de la pantalla del día. `done` es **todo lo que ya no está pendiente** —ejecutadas,
 * canceladas y reagendadas—, no sólo las ejecutadas: si no, una gestión cancelada desaparecería
 * del día y cancelar sería indistinguible de eliminar. La pantalla las distingue con su etiqueta.
 *
 * 🔴 Tiene test de no-regresión: la pantalla del móvil usaba `=== EXECUTED` y perdía las
 * canceladas.
 */
export function partitionDay<T extends { status: AgendaItemStatus }>(items: T[]): { pending: T[]; done: T[] } {
  return {
    pending: items.filter((i) => i.status === AgendaItemStatus.SCHEDULED),
    done: items.filter((i) => i.status !== AgendaItemStatus.SCHEDULED),
  };
}

// ── Fechas ───────────────────────────────────────────────────────────────────
// Sin `Date` en el medio donde se pueda evitar: es de donde salen los corrimientos de un día.

/** Hoy como `YYYY-MM-DD` en UTC — el backend guarda las fechas-calendario a medianoche UTC. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → `Date` local, para alimentar un picker sin correr un día. */
export function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** `Date` en hora local → `YYYY-MM-DD`. */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `Date` en hora local → `HH:mm`. */
export function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ── El formulario de una gestión ─────────────────────────────────────────────

export type AgendaTimeMode = ScheduleTimeMode.FIXED | ScheduleTimeMode.LAPSE;

export interface AgendaFormState {
  type: AgendaItemType;
  /** Cliente elegido en el buscador. */
  clientId: string | null;
  /** Crédito/caso elegido (auto si el cliente tiene uno solo). */
  caseId: string | null;
  creditId: string | null;
  /** Campos propios del tipo. Su forma la valida `validateAgendaDetails`. */
  details: Record<string, unknown>;
  observations: string;
  /** `YYYY-MM-DD` (mismo anclaje UTC que la pantalla del día). */
  scheduledDate: string;
  timeMode: AgendaTimeMode;
  scheduledTime: string;
  timeSlot: AgendaTimeSlot;
}

export type AgendaFormAction =
  /** Modo edición: reemplaza el estado entero con el del agendado que se abre. */
  | { t: 'hydrate'; state: AgendaFormState }
  | { t: 'type'; value: AgendaItemType }
  | { t: 'client'; clientId: string }
  | { t: 'clearClient' }
  | { t: 'credit'; caseId: string; creditId: string }
  | { t: 'details'; patch: Record<string, unknown> }
  | { t: 'observations'; value: string }
  | { t: 'date'; value: string }
  | { t: 'timeMode'; value: AgendaTimeMode }
  | { t: 'time'; value: string }
  | { t: 'slot'; value: AgendaTimeSlot };

export function initialAgendaForm(today: string): AgendaFormState {
  return {
    type: AgendaItemType.CALL,
    clientId: null,
    caseId: null,
    creditId: null,
    details: {},
    observations: '',
    scheduledDate: today,
    timeMode: ScheduleTimeMode.FIXED,
    scheduledTime: '',
    timeSlot: AgendaTimeSlot.MORNING,
  };
}

export function agendaFormReducer(state: AgendaFormState, action: AgendaFormAction): AgendaFormState {
  switch (action.t) {
    case 'hydrate':
      return action.state;

    // Cambiar de tipo invalida los campos propios (un contactId no sirve para una visita),
    // pero conserva cliente, crédito, fecha y hora: es lo que la persona ya eligió.
    case 'type':
      return { ...state, type: action.value, details: {} };

    // Otro cliente → sus contactos/direcciones dejan de existir, y el caso hay que reelegirlo.
    case 'client':
      return { ...state, clientId: action.clientId, caseId: null, creditId: null, details: {} };
    case 'clearClient':
      return { ...state, clientId: null, caseId: null, creditId: null, details: {} };

    case 'credit':
      return { ...state, caseId: action.caseId, creditId: action.creditId };
    case 'details':
      return { ...state, details: { ...state.details, ...action.patch } };
    case 'observations':
      return { ...state, observations: action.value };
    case 'date':
      return { ...state, scheduledDate: action.value };
    case 'timeMode':
      return { ...state, timeMode: action.value };
    case 'time':
      return { ...state, scheduledTime: action.value };
    case 'slot':
      return { ...state, timeSlot: action.value };
  }
}

/** La programación está completa: hora exacta si `FIXED`, franja si `LAPSE`. */
function scheduleReady(state: AgendaFormState): boolean {
  return state.timeMode === ScheduleTimeMode.FIXED ? /^([01]\d|2[0-3]):[0-5]\d$/.test(state.scheduledTime) : true;
}

/** `details` normalizado, o `null` si todavía no cumple las reglas del tipo. */
function validDetails(state: AgendaFormState): AgendaDetails | null {
  const res = validateAgendaDetails(state.type, state.details);
  return res.ok ? res.value : null;
}

/**
 * Habilita guardar: cliente + crédito + programación + `details` válido para el tipo.
 *
 * `requiresBank` no lo puede saber el validador puro (vive en `catalog_items.metadata` del
 * tenant), así que lo pasa la pantalla. Sin esto el botón se habilita y el server rechaza con
 * AGENDA_006 después del round-trip.
 */
export function canSubmitAgenda(state: AgendaFormState, requiresBank = false): boolean {
  if (!state.clientId || !state.caseId || !state.creditId) return false;
  if (!scheduleReady(state) || validDetails(state) === null) return false;
  return !requiresBank || Boolean(state.details.bankCode);
}

/**
 * Estado inicial en **modo edición**: el ítem ya elegido, con su cliente, su crédito y sus campos.
 * El deudor no se puede cambiar editando, así que se toma tal cual viene.
 */
export function hydrateAgendaForm(item: AgendaListItem): AgendaFormState {
  const fixed = item.timeMode === ScheduleTimeMode.FIXED;
  return {
    type: item.type,
    clientId: item.clientId,
    caseId: item.caseId,
    creditId: item.creditId,
    details: { ...(item.details as Record<string, unknown>) },
    observations: item.observations ?? '',
    scheduledDate: item.scheduledDate.slice(0, 10),
    timeMode: fixed ? ScheduleTimeMode.FIXED : ScheduleTimeMode.LAPSE,
    scheduledTime: item.scheduledTime ?? '',
    timeSlot: (item.timeSlot as AgendaTimeSlot) ?? AgendaTimeSlot.MORNING,
  };
}

/**
 * Cuerpo de `PATCH /agenda/:id`, o `null` si el formulario no está completo.
 *
 * **Nunca emite `scheduledDate`, `caseId` ni `clientId`**: mover el día es reagendar (deja rastro)
 * y el deudor es el ancla del agendado. El server ni siquiera los acepta; esto lo hace explícito.
 */
export function buildAgendaPatch(state: AgendaFormState): UpdateAgendaInput | null {
  const details = validDetails(state);
  if (!details || !scheduleReady(state)) return null;
  const fixed = state.timeMode === ScheduleTimeMode.FIXED;
  return {
    type: state.type,
    timeMode: state.timeMode,
    scheduledTime: fixed ? state.scheduledTime : undefined,
    timeSlot: fixed ? undefined : state.timeSlot,
    observations: state.observations.trim(),
    details,
  };
}

/** Cuerpo de `POST /agenda`, o `null` si el formulario todavía no está completo. */
export function buildAgendaPayload(state: AgendaFormState): CreateAgendaInput | null {
  const details = validDetails(state);
  if (!details || !state.caseId || !state.creditId || !scheduleReady(state)) return null;
  const fixed = state.timeMode === ScheduleTimeMode.FIXED;
  return {
    caseId: state.caseId,
    creditId: state.creditId,
    type: state.type,
    scheduledDate: state.scheduledDate,
    timeMode: state.timeMode,
    scheduledTime: fixed ? state.scheduledTime : undefined,
    timeSlot: fixed ? undefined : state.timeSlot,
    observations: state.observations.trim() || undefined,
    details,
  };
}
