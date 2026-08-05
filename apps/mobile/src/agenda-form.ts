/**
 * Estado del formulario "Nueva gestión" (Agenda S2). Reducer puro, sin React ni red: la pantalla
 * sólo despacha y pinta. Las reglas de `details` NO se reescriben acá — las decide
 * `validateAgendaDetails` de `@kobrax/shared`, el mismo validador que corre el server.
 */
import {
  AgendaItemStatus,
  AgendaItemType,
  AgendaTimeSlot,
  ScheduleTimeMode,
  SUPPORTED_CURRENCIES,
  TIME_SLOT_HOURS,
  formatCurrency,
  validateAgendaDetails,
  type AgendaDetails,
} from '@kobrax/shared';
import type { AgendaListItem, CreateAgendaInput, UpdateAgendaInput } from './agenda.service';

export type TimeSlot = AgendaTimeSlot;
export type TimeMode = ScheduleTimeMode.FIXED | ScheduleTimeMode.LAPSE;

// Nombres en español a mano, no `Intl`: Hermes no siempre trae los locales en gama baja.
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const WEEKDAYS_SHORT = ['DO', 'LU', 'MA', 'MI', 'JU', 'VI', 'SA'];
const WEEKDAYS_LONG = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Hoy como `YYYY-MM-DD` en UTC — el backend guarda las fechas-calendario a medianoche UTC. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` → `Date` local, para alimentar el picker nativo sin correr un día. */
export function toLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

/** Lo que devuelve el picker nativo (hora local) → `YYYY-MM-DD` / `HH:mm`. Los usan el alta y el reagendado. */
export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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

/**
 * El rango horario de la franja, para el chip de «hora recomendada» (Rutas S4). Se **deriva** de
 * `TIME_SLOT_HOURS` de shared, que es con lo que la API agrupa: si se escribiera a mano, el chip
 * podría anunciar un horario distinto del que se contó.
 */
export function timeSlotRange(slot: AgendaTimeSlot): string {
  const { from, to } = TIME_SLOT_HOURS[slot];
  return `${String(from).padStart(2, '0')}:00 - ${String(to).padStart(2, '0')}:00`;
}

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
  /** Modo edición (S5): reemplaza el estado entero con el del agendado que se abre. */
  | { t: 'hydrate'; state: FormState }
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
    case 'hydrate':
      return action.state;

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

/**
 * Estado inicial del formulario en **modo edición** (S5): el ítem ya elegido, con su cliente, su
 * crédito y sus campos. El deudor no se puede cambiar editando, así que se toma tal cual viene.
 */
export function hydrateForm(item: AgendaListItem): FormState {
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
    timeSlot: (item.timeSlot as TimeSlot) ?? AgendaTimeSlot.MORNING,
  };
}

/**
 * Cuerpo de `PATCH /agenda/:id`, o `null` si el formulario no está completo.
 *
 * **Nunca emite `scheduledDate`, `caseId` ni `clientId`**: mover el día es reagendar (deja rastro) y
 * el deudor es el ancla del agendado. El server ni siquiera los acepta; esto lo hace explícito acá.
 */
export function buildPatch(state: FormState): UpdateAgendaInput | null {
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

/**
 * Reparto de la pantalla del día. `done` es **todo lo que ya no está pendiente** — ejecutadas,
 * canceladas y reagendadas —, no sólo las ejecutadas: si no, una gestión cancelada desaparecería de
 * la app y cancelar sería indistinguible de eliminar. La tarjeta las distingue con su etiqueta.
 */
export function partitionDay<T extends { status: AgendaItemStatus }>(items: T[]): { pending: T[]; done: T[] } {
  return {
    pending: items.filter((i) => i.status === AgendaItemStatus.SCHEDULED),
    done: items.filter((i) => i.status !== AgendaItemStatus.SCHEDULED),
  };
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
