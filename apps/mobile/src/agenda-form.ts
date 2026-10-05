/**
 * Lo que la agenda del teléfono pone de su lado: los rótulos y el formato de fecha en español.
 *
 * **La máquina del formulario y el reparto del día viven en `@kobrax/shared`** (F9 W5 T1): los
 * consumen también el panel web, y una segunda copia acá haría que el escritorio y el teléfono
 * dijeran cosas distintas sobre la misma agenda.
 *
 * Se re-exportan con los nombres de siempre para que las pantallas sigan importando de un solo lado.
 */
import {
  agendaFormReducer,
  buildAgendaPatch,
  buildAgendaPayload,
  canSubmitAgenda,
  hydrateAgendaForm,
  initialAgendaForm,
  AgendaTimeSlot,
  ScheduleTimeMode,
  SUPPORTED_CURRENCIES,
  TIME_SLOT_HOURS,
  formatCurrency,
  type AgendaFormAction as SharedFormAction,
  type AgendaFormState as FormState,
  type AgendaListItem,
  type CreateAgendaInput,
  type UpdateAgendaInput,
} from '@kobrax/shared';

export {
  partitionDay,
  toHHmm,
  toISO,
  toLocalDate,
  todayISO,
} from '@kobrax/shared';
export type { FormState };

/**
 * F4/08: la agenda cuelga del **crédito**; el formulario de shared todavía exige `caseId` (`canSubmitAgenda`,
 * `buildAgendaPayload`). Hasta que shared lo suelte, el móvil usa el `creditId` como relleno de `caseId` dentro
 * del estado y lo quita del cuerpo que se envía: el server ni lo mira. Estos envoltorios son el único lugar que lo sabe.
 */
export type FormAction = Exclude<SharedFormAction, { t: 'credit' }> | { t: 'credit'; creditId: string };

export function initialForm(today: string): FormState {
  return initialAgendaForm(today);
}

export function formReducer(state: FormState, action: FormAction): FormState {
  if (action.t === 'credit') return { ...state, creditId: action.creditId, caseId: action.creditId };
  return agendaFormReducer(state, action);
}

/** El agendado abierto en edición: el crédito es el ancla (el `caseId` es el relleno, ver arriba). */
export function hydrateForm(item: AgendaListItem): FormState {
  return { ...hydrateAgendaForm(item), caseId: item.creditId };
}

const withPlaceholder = (state: FormState): FormState => (state.creditId ? { ...state, caseId: state.creditId } : state);

export function canSubmit(state: FormState, requiresBank = false): boolean {
  return canSubmitAgenda(withPlaceholder(state), requiresBank);
}

/** Cuerpo de `POST /agenda`: sin `caseId`, sólo `creditId`. */
export function buildPayload(state: FormState): CreateAgendaInput | null {
  const payload = buildAgendaPayload(withPlaceholder(state));
  if (!payload) return null;
  const { caseId: _relleno, ...rest } = payload;
  return rest;
}

export function buildPatch(state: FormState): UpdateAgendaInput | null {
  return buildAgendaPatch(withPlaceholder(state));
}

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
 * Decimales que muestra el teléfono, la preferencia de la cuenta (`currencyDecimals`).
 *
 * Variable de módulo y no un parámetro: **todas** las pantallas del móvil formatean plata con
 * este `money()`, y la app corre con una sola cuenta por sesión — el que la siembra es
 * `getAccount()` al cargar la cuenta (con o sin señal, porque viene de la copia local).
 */
let MONEY_DECIMALS = 2;

export function setMoneyDecimals(n: number): void {
  MONEY_DECIMALS = Number.isInteger(n) && n >= 0 && n <= 2 ? n : 2;
}

/**
 * `formatCurrency` explota con una moneda fuera de las 6 soportadas; el saldo no vale una pantalla
 * en blanco. Lo usan el alta (S2) y el detalle (S3).
 */
export function money(amount: number, currency: string): string {
  return currency in SUPPORTED_CURRENCIES
    ? formatCurrency(amount, currency as keyof typeof SUPPORTED_CURRENCIES, MONEY_DECIMALS)
    : `${amount.toFixed(MONEY_DECIMALS)} ${currency}`;
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
