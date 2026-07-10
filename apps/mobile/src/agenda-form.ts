/**
 * Estado del formulario "Nueva gestión" (Agenda S2). Reducer puro, sin React ni red: la pantalla
 * sólo despacha y pinta. Las reglas de `details` NO se reescriben acá — las decide
 * `validateAgendaDetails` de `@kobrax/shared`, el mismo validador que corre el server.
 */
import {
  AgendaItemType,
  AgendaTimeSlot,
  ScheduleTimeMode,
  SUPPORTED_CURRENCIES,
  formatCurrency,
  validateAgendaDetails,
  type AgendaDetails,
} from '@kobrax/shared';
import type { CreateAgendaInput } from './agenda.service';

export type TimeSlot = AgendaTimeSlot;
export type TimeMode = ScheduleTimeMode.FIXED | ScheduleTimeMode.LAPSE;

// Nombres en español a mano, no `Intl`: Hermes no siempre trae los locales en gama baja.
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const WEEKDAYS_SHORT = ['DO', 'LU', 'MA', 'MI', 'JU', 'VI', 'SA'];
const WEEKDAYS_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** `2026-06-23` → `Lunes, 23 de junio` (la fecha se lee en UTC, como se guarda). */
export function formatLongDate(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  return `${WEEKDAYS_LONG[d.getUTCDay()]}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
}

/**
 * `formatCurrency` explota con una moneda fuera de las 6 soportadas; el saldo no vale una pantalla
 * en blanco. Lo usan el alta (S2) y el detalle (S3).
 */
export function money(amount: number, currency: string): string {
  return currency in SUPPORTED_CURRENCIES
    ? formatCurrency(amount, currency as keyof typeof SUPPORTED_CURRENCIES)
    : `${amount.toFixed(2)} ${currency}`;
}

/** El enum es dominio (shared); la etiqueta en español es UI y vive acá. */
export const TIME_SLOT_LABEL: Record<AgendaTimeSlot, string> = {
  [AgendaTimeSlot.MORNING]: 'Mañana',
  [AgendaTimeSlot.AFTERNOON]: 'Tarde',
  [AgendaTimeSlot.NIGHT]: 'Noche',
};

export interface FormState {
  type: AgendaItemType;
  /** Cliente elegido en el buscador. */
  clientId: string | null;
  /** Crédito/caso elegido (auto si el cliente tiene uno solo). */
  caseId: string | null;
  creditId: string | null;
  /** Campos propios del tipo. Su forma la valida shared. */
  details: Record<string, unknown>;
  observations: string;
  /** `YYYY-MM-DD` (mismo anclaje UTC que la pantalla principal). */
  scheduledDate: string;
  timeMode: TimeMode;
  scheduledTime: string;
  timeSlot: TimeSlot;
}

export type FormAction =
  | { t: 'type'; value: AgendaItemType }
  | { t: 'client'; clientId: string }
  | { t: 'clearClient' }
  | { t: 'credit'; caseId: string; creditId: string }
  | { t: 'details'; patch: Record<string, unknown> }
  | { t: 'observations'; value: string }
  | { t: 'date'; value: string }
  | { t: 'timeMode'; value: TimeMode }
  | { t: 'time'; value: string }
  | { t: 'slot'; value: TimeSlot };

export function initialForm(todayISO: string): FormState {
  return {
    type: AgendaItemType.CALL,
    clientId: null,
    caseId: null,
    creditId: null,
    details: {},
    observations: '',
    scheduledDate: todayISO,
    timeMode: ScheduleTimeMode.FIXED,
    scheduledTime: '',
    timeSlot: AgendaTimeSlot.MORNING,
  };
}

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.t) {
    // Cambiar de tipo invalida los campos propios (un contactId no sirve para una visita),
    // pero conserva cliente, crédito, fecha y hora: es lo que el cobrador ya eligió.
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
function scheduleReady(state: FormState): boolean {
  return state.timeMode === ScheduleTimeMode.FIXED ? /^([01]\d|2[0-3]):[0-5]\d$/.test(state.scheduledTime) : true;
}

/** `details` normalizado, o `null` si aún no cumple las reglas del tipo. */
function validDetails(state: FormState): AgendaDetails | null {
  const res = validateAgendaDetails(state.type, state.details);
  return res.ok ? res.value : null;
}

/**
 * Habilita "Guardar gestión": cliente + crédito + programación + `details` válido para el tipo.
 *
 * `requiresBank` no lo puede saber el validador puro (vive en `catalog_items.metadata` del tenant),
 * así que lo pasa la pantalla. Sin esto el botón se habilita y el server rechaza con AGENDA_006
 * después del round-trip — y offline, sin decir por qué.
 */
export function canSubmit(state: FormState, requiresBank = false): boolean {
  if (!state.clientId || !state.caseId || !state.creditId) return false;
  if (!scheduleReady(state) || validDetails(state) === null) return false;
  return !requiresBank || Boolean(state.details.bankCode);
}

/** Cuerpo de `POST /agenda`, o `null` si el formulario todavía no está completo. */
export function buildPayload(state: FormState): CreateAgendaInput | null {
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
