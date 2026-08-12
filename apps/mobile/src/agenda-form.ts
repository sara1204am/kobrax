/**
 * Lo que la agenda del teléfono pone de su lado: los rótulos y el formato de fecha en español.
 *
 * **La máquina del formulario y el reparto del día viven en `@kobrax/shared`** (F9 W5 T1): los
 * consumen también el panel web, y una segunda copia acá haría que el escritorio y el teléfono
 * dijeran cosas distintas sobre la misma agenda.
 *
 * Se re-exportan con los nombres de siempre para que las pantallas sigan importando de un solo lado.
 */
import { AgendaTimeSlot, ScheduleTimeMode, SUPPORTED_CURRENCIES, TIME_SLOT_HOURS, formatCurrency } from '@kobrax/shared';

export {
  agendaFormReducer as formReducer,
  buildAgendaPatch as buildPatch,
  buildAgendaPayload as buildPayload,
  canSubmitAgenda as canSubmit,
  hydrateAgendaForm as hydrateForm,
  initialAgendaForm as initialForm,
  partitionDay,
  toHHmm,
  toISO,
  toLocalDate,
  todayISO,
} from '@kobrax/shared';
export type { AgendaFormAction as FormAction, AgendaFormState as FormState } from '@kobrax/shared';

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

/**
 * El rango horario de la franja, para el chip de «hora recomendada» (Rutas S4). Se **deriva** de
 * `TIME_SLOT_HOURS` de shared, que es con lo que la API agrupa: si se escribiera a mano, el chip
 * podría anunciar un horario distinto del que se contó.
 */
export function timeSlotRange(slot: AgendaTimeSlot): string {
  const { from, to } = TIME_SLOT_HOURS[slot];
  return `${String(from).padStart(2, '0')}:00 - ${String(to).padStart(2, '0')}:00`;
}
